const { ethers: {
	BigNumber,
	getNamedSigners,
} } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployProtocol, makeERC721Request, makeMetaContribution, getValidation } = require("../helpers");
const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { calculateInterestAndFee, partialPaymentParameters } = require("../math");

describe("Repayment", function () {
	let defaultFeeNumenator = BigNumber.from(1000);  // 10%
	let defaultAuctionLength = BigNumber.from(3600);

	let defaultAmount = BigNumber.from(1000);
	let defaultAPR = BigNumber.from(2000); // 20%
	let defaultLiquidityLimit = BigNumber.from(1000);
	let defaultTotalFundsOffered = BigNumber.from(1000);
	let oneYearLoanLength = BigNumber.from(31536000);

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
		const {
			bob,
			alice,
			validator
		} = await getNamedSigners();

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

	beforeEach(async function () {
		const protocolSetup = await loadFixture(deployProtocolWrapper);

		sodiumERC721Manager = protocolSetup.sodiumERC721Manager;
		sodiumERC1155Manager = protocolSetup.sodiumERC1155Manager;
		walletFactory = protocolSetup.walletFactory;
		registry = protocolSetup.registry;
		weth = protocolSetup.weth;
		erc721mock = protocolSetup.erc721mock;
	});

	it("Should revert repayment for the loan ended", async function () {
		const { bob, alice } = await getNamedSigners();

		const repaymentAmount = BigNumber.from(1000);
		const latestBlockTimestamp = await time.latest();
		const deadline = BigNumber.from(1000).add(latestBlockTimestamp);
		const quickEndingLoanLength = BigNumber.from(100);

		const { requestId, metaContribution, validation } = await setupRequest(deadline, quickEndingLoanLength);

		weth.transferFrom.whenCalledWith(alice.address, bob.address, defaultAmount)
			.returns(true);

		await expect(sodiumERC721Manager.connect(bob).borrowFromMetaLenders(requestId, [metaContribution], [defaultAmount], validation))
			.emit(sodiumERC721Manager, "FundsAdded").
			withArgs(requestId, alice.address, defaultAmount, metaContribution.APR);

		await time.increase(100);

		await expect(sodiumERC721Manager.connect(bob).repay(requestId, repaymentAmount))
			.revertedWith("Sodium: loan ended");
	})

	it("Should make full repayment succesfully", async function () {
		const { bob, alice, treasury } = await getNamedSigners();

		const validationDeadline = BigNumber.from(1000).add((await time.latest()));
		const repaymentAmount = BigNumber.from(1110);

		const { requestId, metaContribution, validation } = await setupRequest(
			validationDeadline,
		);

		weth.transferFrom.whenCalledWith(alice.address, bob.address, defaultAmount)
			.returns(true);

		await sodiumERC721Manager.connect(bob).borrowFromMetaLenders(requestId, [metaContribution], [defaultAmount], validation)

		const effectivedDuratioin = oneYearLoanLength.div(2);
		const { baseInterestMinusBaseFee, doubleBaseFee } = calculateInterestAndFee(
			defaultAmount,
			defaultAPR,
			effectivedDuratioin,
			defaultFeeNumenator
		);

		weth.transferFrom.whenCalledWith(bob.address, alice.address, defaultAmount.add(baseInterestMinusBaseFee))
			.returns(true);

		weth.transferFrom.whenCalledWith(bob.address, treasury.address, doubleBaseFee)
			.returns(true);

		await expect(sodiumERC721Manager.connect(bob).repay(requestId, repaymentAmount))
			.emit(sodiumERC721Manager, "RepaymentMade")
			.withArgs(requestId, alice.address, defaultAmount, baseInterestMinusBaseFee, doubleBaseFee);

		expect(await erc721mock.balanceOf(bob.address)).equals(1);
	})

	it("Should make partial repayment succesfully", async function () {
		const { bob, alice, treasury } = await getNamedSigners();

		const validationDeadline = BigNumber.from(1000).add((await time.latest()));
		const partialRepaymentAmount = BigNumber.from(800);

		const { requestId, metaContribution, validation } = await setupRequest(
			validationDeadline,
		);

		weth.transferFrom.whenCalledWith(alice.address, bob.address, defaultAmount)
			.returns(true);

		const effectivedDuratioin = oneYearLoanLength.div(2);
		const { reductionMinusFee, interestMinusFee, doubleBaseFee }
			= partialPaymentParameters(partialRepaymentAmount, defaultAPR, effectivedDuratioin, defaultFeeNumenator);

		await sodiumERC721Manager.connect(bob).borrowFromMetaLenders(requestId, [metaContribution], [defaultAmount], validation)

		weth.transferFrom.whenCalledWith(bob.address, alice.address, reductionMinusFee + interestMinusFee)
			.returns(true);

		weth.transferFrom.whenCalledWith(bob.address, treasury.address, doubleBaseFee)
			.returns(true);

		await expect(sodiumERC721Manager.connect(bob).repay(requestId, partialRepaymentAmount))
			.emit(sodiumERC721Manager, "RepaymentMade")
			.withArgs(requestId, alice.address, reductionMinusFee, interestMinusFee, doubleBaseFee);

		expect(await erc721mock.balanceOf(bob.address)).equals(0);
	})

	it("Should make partial full repayment to the second lender and partial to the first one", async function () {
		const { bob, alice, lucy, treasury, validator } = await getNamedSigners();

		const validationDeadline = BigNumber.from(1000).add((await time.latest()));
		const lucyLiquidityLimit = defaultLiquidityLimit.add(defaultTotalFundsOffered);
		const partialRepaymentAmount = BigNumber.from(800);
		const amountsToBorrow = [defaultAmount, defaultAmount];

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
		const validation = await getValidation(validator, validationDeadline, contributions);

		weth.transferFrom.whenCalledWith(alice.address, bob.address, defaultAmount)
			.returns(true);

		weth.transferFrom.whenCalledWith(lucy.address, bob.address, defaultAmount)
			.returns(true);

		await sodiumERC721Manager.connect(bob).borrowFromMetaLenders(requestId, contributions, amountsToBorrow, validation)


		const effectivedDuratioin = oneYearLoanLength.div(2);
		const { baseInterestMinusBaseFee, doubleBaseFee } = calculateInterestAndFee(defaultAmount, defaultAPR, effectivedDuratioin, defaultFeeNumenator);

		const partialRepaymentObj = partialPaymentParameters(partialRepaymentAmount, defaultAPR, effectivedDuratioin, defaultFeeNumenator);
		const amountToRepay = defaultAmount.add(baseInterestMinusBaseFee).add(doubleBaseFee).add(partialRepaymentAmount);

		const partialRepaymentToAlice = partialRepaymentObj.reductionMinusFee + partialRepaymentObj.interestMinusFee;
		const aliceProtocolFee = partialRepaymentObj.doubleBaseFee;


		// full repayment to the second lender
		weth.transferFrom.whenCalledWith(bob.address, lucy.address, defaultAmount.add(baseInterestMinusBaseFee))
			.returns(true);

		weth.transferFrom.whenCalledWith(bob.address, treasury.address, doubleBaseFee)
			.returns(true);


		// partial repayment to the first lender
		weth.transferFrom.whenCalledWith(bob.address, alice.address, partialRepaymentToAlice)
			.returns(true);

		weth.transferFrom.whenCalledWith(bob.address, treasury.address, aliceProtocolFee)
			.returns(true);

		await sodiumERC721Manager.connect(bob).repay(requestId, amountToRepay);
		const repaymentMadeEvents = await sodiumERC721Manager.queryFilter(
			sodiumERC721Manager.filters.RepaymentMade()
		)

		const lucyRepayment = repaymentMadeEvents[0].args;
		const aliceRepayment = repaymentMadeEvents[1].args;

		expect(lucyRepayment[0].toString()).equals(requestId.toString());
		expect(lucyRepayment[1]).equals(lucy.address);
		expect(lucyRepayment[2].toString()).equals(defaultAmount.toString());
		expect(lucyRepayment[3].toString()).equals(baseInterestMinusBaseFee.toString());
		expect(lucyRepayment[4].toString()).equals(doubleBaseFee.toString());

		expect(aliceRepayment[0].toString()).equals(requestId.toString());
		expect(aliceRepayment[1]).equals(alice.address);
		expect(aliceRepayment[2].toString()).equals(partialRepaymentObj.reductionMinusFee.toString());
		expect(aliceRepayment[3].toString()).equals(partialRepaymentObj.interestMinusFee.toString());
		expect(aliceRepayment[4].toString()).equals(partialRepaymentObj.doubleBaseFee.toString());
	})
})