
const { ethers: {
	BigNumber,
	getNamedSigners,
} } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployProtocol, makeERC721Request, makeMetaContribution, getValidation } = require("../helpers");
const { partialPaymentParameters, principalPlusInterest } = require("../math");
const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Auction", function () {
	let defaultFeeNumenator = BigNumber.from(1000);  // 10%
	let defaultAuctionLength = BigNumber.from(3600);

	let defaultValidationDeadline;

	let defaultAmount = BigNumber.from(1000);
	let defaultAPR = BigNumber.from(2000); // 20%
	let defaultLiquidityLimit = BigNumber.from(1000);
	let defaultTotalFundsOffered = BigNumber.from(1000);
	let oneYearLoanLength = BigNumber.from(31536000);
	let defaultAmountsToBorrow = [defaultAmount, defaultAmount];

	let sodiumERC721Manager;
	let weth;
	let erc721mock;

	async function deployProtocolWrapper() {
		const { sodiumERC721Manager, sodiumERC1155Manager, walletFactory, registry, weth, erc721mock } =
			await deployProtocol(defaultFeeNumenator, defaultAuctionLength);

		return { sodiumERC721Manager, sodiumERC1155Manager, walletFactory, registry, weth, erc721mock };
	}

	async function setupRequest(
		validationDeadline,
		loanLength = oneYearLoanLength,
		liquidityLimit = defaultLiquidityLimit,
		APR = defaultAPR,
		totalFundsOffered = defaultTotalFundsOffered
	) {
		const { bob, alice, validator } = await getNamedSigners();
		const tokenId = BigNumber.from(0);
		await erc721mock.connect(bob).mint(bob.address, tokenId);

		const { requestId } = await makeERC721Request(
			bob,
			tokenId,
			loanLength,
			[],
			erc721mock,
			sodiumERC721Manager
		);

		const metaContribution = await makeMetaContribution(
			requestId,
			alice,
			sodiumERC721Manager,
			totalFundsOffered,
			liquidityLimit,
			APR
		)

		const validation = await getValidation(validator, validationDeadline, [metaContribution]);
		return {
			requestId, metaContribution, validation
		}
	}

	async function setupDoubleMetaContributions() {
		const { bob, alice, lucy, validator } = await getNamedSigners();

		const tokenId = BigNumber.from(0);
		const lucyLiquidityLimit = defaultLiquidityLimit.add(defaultTotalFundsOffered);
		await erc721mock.connect(bob).mint(bob.address, tokenId);

		const { requestId } = await makeERC721Request(
			bob,
			tokenId,
			oneYearLoanLength,
			[],
			erc721mock,
			sodiumERC721Manager
		);

		const metaContributionAlice = await makeMetaContribution(
			requestId,
			alice,
			sodiumERC721Manager,
			defaultTotalFundsOffered,
			defaultLiquidityLimit,
			defaultAPR
		)

		const metaContributionLucy = await makeMetaContribution(
			requestId,
			lucy,
			sodiumERC721Manager,
			defaultTotalFundsOffered,
			lucyLiquidityLimit,
			defaultAPR
		)

		const contributions = [metaContributionAlice, metaContributionLucy];
		const validation = await getValidation(validator, defaultValidationDeadline, contributions);

		weth.transferFrom.whenCalledWith(alice.address, bob.address, defaultAmount)
			.returns(true);

		weth.transferFrom.whenCalledWith(lucy.address, bob.address, defaultAmount)
			.returns(true);

		await sodiumERC721Manager.connect(bob).borrowFromMetaLenders(requestId, contributions, defaultAmountsToBorrow, validation)

		return {
			requestId,
		}
	}

	beforeEach(async function () {
		const protocolSetup = await loadFixture(deployProtocolWrapper);

		sodiumERC721Manager = protocolSetup.sodiumERC721Manager;
		sodiumERC1155Manager = protocolSetup.sodiumERC1155Manager;
		walletFactory = protocolSetup.walletFactory;
		registry = protocolSetup.registry;
		weth = protocolSetup.weth;
		erc721mock = protocolSetup.erc721mock;

		const latestBlockTimestamp = await time.latest();
		defaultValidationDeadline = BigNumber.from(1000).add(latestBlockTimestamp);
	});


	describe("Bid", async function () {
		it("Should revert bid for the loan ended", async function () {
			const { bob, alice } = await getNamedSigners();

			const quickEndingLoanLength = BigNumber.from(100);
			const { requestId, metaContribution, validation } = await setupRequest(defaultValidationDeadline, quickEndingLoanLength);

			weth.transferFrom.whenCalledWith(alice.address, bob.address, defaultAmount)
				.returns(true);

			await sodiumERC721Manager.connect(bob).borrowFromMetaLenders(requestId, [metaContribution], [defaultAmount], validation)

			await expect(sodiumERC721Manager.connect(alice).bid(requestId, defaultAmount, 0))
				.revertedWith("Sodium: loan is not ended; auction is ended");
		})

		it("Should revert bid for the auction ended", async function () {
			const { bob, alice } = await getNamedSigners();

			const quickEndingLoanLength = BigNumber.from(100);
			const { requestId, metaContribution, validation } = await setupRequest(defaultValidationDeadline, quickEndingLoanLength);

			weth.transferFrom.whenCalledWith(alice.address, bob.address, defaultAmount)
				.returns(true);

			await sodiumERC721Manager.connect(bob).borrowFromMetaLenders(requestId, [metaContribution], [defaultAmount], validation)

			const latestBlockTimestamp = await time.latest();
			const loanEndDate = quickEndingLoanLength.add(latestBlockTimestamp);
			const auctionEndTimestamp = loanEndDate.add(defaultAuctionLength + 10);

			await time.increaseTo(auctionEndTimestamp);

			await expect(sodiumERC721Manager.connect(alice).bid(requestId, defaultAmount, 0))
				.revertedWith("Sodium: loan is not ended; auction is ended");
		})

		it("Should revert bid because msg.sender's index is wrong", async function () {
			const { lucy } = await getNamedSigners();
			const { requestId } = await setupDoubleMetaContributions();

			const latestBlockTimestamp = await time.latest();
			const loanEndDate = oneYearLoanLength.add(latestBlockTimestamp);
			await time.increaseTo(loanEndDate);

			weth.transferFrom.whenCalledWith(lucy.address, sodiumERC721Manager.address, defaultAmount).returns(true);

			await expect(sodiumERC721Manager.connect(lucy).bid(requestId, defaultAmount, 0))
				.revertedWith("Sodium: wrong index");
		})

		it("Should make a boosted bid successfully", async function () {
			const { lucy } = await getNamedSigners();
			const { requestId } = await setupDoubleMetaContributions();
			const bidSize = BigNumber.from(6000);
			const boostIndex = 1;

			const latestBlockTimestamp = await time.latest();
			const loanEndDate = oneYearLoanLength.add(latestBlockTimestamp);

			await time.increaseTo(loanEndDate);
			const principalWithInterest = principalPlusInterest(
				defaultAmount.toNumber(),
				defaultAPR.toNumber(),
				oneYearLoanLength.toNumber()
			);

			weth.transferFrom.whenCalledWith(lucy.address, sodiumERC721Manager.address, bidSize).returns(true);

			await expect(sodiumERC721Manager.connect(lucy).bid(requestId, bidSize, boostIndex))
				.emit(sodiumERC721Manager, "BidMade")
				.withArgs(requestId, lucy.address, bidSize.toNumber() + principalWithInterest, principalPlusInterest, boostIndex)
		})

		it("Should make a non-boosted bid successfully", async function () {
			const { lucy } = await getNamedSigners();
			const { requestId } = await setupDoubleMetaContributions();
			const bidSize = BigNumber.from(6000);
			const boostIndex = 2;

			const latestBlockTimestamp = await time.latest();
			const loanEndDate = oneYearLoanLength.add(latestBlockTimestamp);

			await time.increaseTo(loanEndDate);

			weth.transferFrom.whenCalledWith(lucy.address, sodiumERC721Manager.address, bidSize)
				.returns(true);

			await expect(sodiumERC721Manager.connect(lucy).bid(requestId, bidSize, boostIndex))
				.emit(sodiumERC721Manager, "BidMade")
				.withArgs(requestId, lucy.address, bidSize, 0, boostIndex)
		})
	})

	describe("Purchase", async function () {
		it("Should be reverted on the second boosted bid because its amount is less than previous boosted bid", async function () {
			const { alice, lucy } = await getNamedSigners();
			const { requestId } = await setupDoubleMetaContributions();
			const bidSize = BigNumber.from(6000);

			const latestBlockTimestamp = await time.latest();
			const loanEndDate = oneYearLoanLength.add(latestBlockTimestamp);

			await time.increaseTo(loanEndDate);


			weth.transferFrom.whenCalledWith(alice.address, sodiumERC721Manager.address, bidSize)
				.returns(true);

			await sodiumERC721Manager.connect(alice).bid(requestId, bidSize, 0)

			weth.transfer.whenCalledWith(alice.address, bidSize)
				.returns(true);

			weth.transferFrom.whenCalledWith(lucy.address, sodiumERC721Manager.address, bidSize)
				.returns(true);

			await expect(sodiumERC721Manager.connect(lucy).bid(requestId, bidSize, 1))
				.revertedWith("Sodium: previous boosted bid is higher");
		})

		it("Should make a successful purchase with repayment to the previous bidder", async function () {
			const { lucy, alice } = await getNamedSigners();
			const { requestId } = await setupDoubleMetaContributions();
			const bidSize = BigNumber.from(6000);
			const boostIndex = 1;

			const latestBlockTimestamp = await time.latest();
			const loanEndDate = oneYearLoanLength.add(latestBlockTimestamp);

			await time.increaseTo(loanEndDate);
			await sodiumERC721Manager.connect(lucy).bid(requestId, bidSize, boostIndex)

			const owedToLender = principalPlusInterest(
				defaultAmount.toNumber(),
				defaultAPR.toNumber(),
				oneYearLoanLength.toNumber()
			);

			weth.transfer.whenCalledWith(lucy.address, bidSize).returns(true);
			weth.transferFrom.whenCalledWith(alice.address, lucy.address, owedToLender).returns(true);

			await expect(sodiumERC721Manager.connect(alice).purchase(requestId))
				.emit(sodiumERC721Manager, "PurchaseMade")
				.withArgs(requestId)

			expect(await erc721mock.balanceOf(alice.address)).
				equal(1);
		})

		it("Should make purchase with refunding previous partial repayment", async function () {
			const { lucy, bob, alice, treasury } = await getNamedSigners();
			const { requestId } = await setupDoubleMetaContributions();
			const bidSize = BigNumber.from(6000);
			const boostIndex = 1;

			const latestBlockTimestamp = await time.latest();
			const loanEndDate = oneYearLoanLength.add(latestBlockTimestamp);
			const partialRepaymentAmount = BigNumber.from(800);

			const effectivedDuratioin = oneYearLoanLength.div(2);
			const { reductionMinusFee, interestMinusFee, doubleBaseFee }
				= partialPaymentParameters(partialRepaymentAmount, defaultAPR, effectivedDuratioin, defaultFeeNumenator);

			weth.transferFrom.whenCalledWith(bob.address, lucy.address, reductionMinusFee + interestMinusFee)
				.returns(true);

			weth.transferFrom.whenCalledWith(bob.address, treasury.address, doubleBaseFee)
				.returns(true);

			await expect(sodiumERC721Manager.connect(bob).repay(requestId, partialRepaymentAmount))
				.emit(sodiumERC721Manager, "RepaymentMade")
				.withArgs(requestId, lucy.address, reductionMinusFee, interestMinusFee, doubleBaseFee);

			await time.increaseTo(loanEndDate);
			await sodiumERC721Manager.connect(lucy).bid(requestId, bidSize, boostIndex)

			weth.transferFrom.whenCalledWith(lucy.address, bob.address, partialRepaymentAmount)
				.returns(true);

			const owedToLender = principalPlusInterest(
				defaultAmount.toNumber(),
				defaultAPR.toNumber(),
				oneYearLoanLength.toNumber()
			);

			weth.transferFrom.whenCalledWith(lucy.address, alice.address, owedToLender)
				.returns(true);

			await expect(sodiumERC721Manager.connect(lucy).purchase(requestId))
				.emit(sodiumERC721Manager, "PurchaseMade")
				.withArgs(requestId)

			expect(await erc721mock.balanceOf(lucy.address)).
				equal(1);
		})
	})

	describe("ResolveAuction", async function () {
		it("Should revert because auction is ongoing", async function () {
			const { lucy } = await getNamedSigners();
			const { requestId } = await setupDoubleMetaContributions();

			const latestBlockTimestamp = await time.latest();
			const loanEndDate = oneYearLoanLength.add(latestBlockTimestamp);

			await time.increaseTo(loanEndDate);

			await expect(sodiumERC721Manager.connect(lucy).resolveAuction(requestId))
				.revertedWith("Sodium: auction is not ended");
		})

		it("Should revert because there is no lenders", async function () {
			const { bob, lucy } = await getNamedSigners();
			const tokenId = BigNumber.from(0);
			await erc721mock.connect(bob).mint(bob.address, tokenId);

			const { requestId } = await makeERC721Request(
				bob,
				tokenId,
				oneYearLoanLength,
				[],
				erc721mock,
				sodiumERC721Manager
			);

			const latestBlockTimestamp = await time.latest();
			const loanEndDate = oneYearLoanLength.add(latestBlockTimestamp);

			await time.increaseTo(loanEndDate);

			await expect(sodiumERC721Manager.connect(lucy).resolveAuction(requestId))
				.revertedWith("Sodium: no lenders in loan");
		})

		it("Should resolve auction successfuly with a bid bigger than owed", async function () {
			const { bob, lucy, alice } = await getNamedSigners();
			const { requestId } = await setupDoubleMetaContributions();
			const bidSize = BigNumber.from(6000);
			const aliceIndex = 0;

			const latestBlockTimestamp = await time.latest();
			const loanEndDate = oneYearLoanLength.add(latestBlockTimestamp);
			const auctionEndDate = loanEndDate.add(defaultAuctionLength);

			await time.increaseTo(loanEndDate);

			weth.transferFrom.whenCalledWith(alice.address, sodiumERC721Manager.address, bidSize).returns(true);
			await sodiumERC721Manager.connect(alice).bid(requestId, bidSize, aliceIndex);

			await time.increaseTo(auctionEndDate);
			const owed = principalPlusInterest(
				defaultAmount.toNumber(),
				defaultAPR.toNumber(),
				oneYearLoanLength.toNumber()
			)

			weth.transfer.whenCalledWith(lucy.address, owed).returns(true);
			weth.transfer.whenCalledWith(bob.address, bidSize.sub(owed)).returns(true);

			await expect(sodiumERC721Manager.connect(lucy).resolveAuction(requestId))
				.emit(sodiumERC721Manager, "AuctionConcluded")
				.withArgs(requestId, alice.address)

			expect(await erc721mock.balanceOf(alice.address)).
				equal(1);
		})

		it("Should resolve auction successfuly with  loan.lenders[i] != msg.sender and bid less than owed", async function () {
			const { lucy, alice } = await getNamedSigners();
			const { requestId } = await setupDoubleMetaContributions();
			const bidSize = BigNumber.from(1000);
			const lucyIndex = 1;

			const latestBlockTimestamp = await time.latest();
			const loanEndDate = oneYearLoanLength.add(latestBlockTimestamp);
			const auctionEndDate = loanEndDate.add(defaultAuctionLength);

			await time.increaseTo(loanEndDate);
			weth.transferFrom.whenCalledWith(lucy.address, sodiumERC721Manager.address, bidSize).returns(true);

			await sodiumERC721Manager.connect(lucy).bid(requestId, bidSize, lucyIndex);

			await time.increaseTo(auctionEndDate);
			weth.transfer.whenCalledWith(alice.address, bidSize).returns(true);

			await expect(sodiumERC721Manager.connect(lucy).resolveAuction(requestId))
				.emit(sodiumERC721Manager, "AuctionConcluded")
				.withArgs(requestId, lucy.address)

			expect(await erc721mock.balanceOf(lucy.address)).
				equal(1);
		})
	})
})