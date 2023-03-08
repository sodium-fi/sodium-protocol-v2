const { ethers: {
	BigNumber,
	getNamedSigners,
	utils
} } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployProtocol, makeERC721Request, makeMetaContribution, getValidation } = require("../helpers");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { constants } = require("ethers");
const { calculateInterestAndFee, principalPlusInterest } = require("../math");
const { expect } = require("chai");

describe("Private Pool", function () {
	let defaultFeeNumenator = BigNumber.from(1000);  // 10%
	let defaultAuctionLength = BigNumber.from(360_000);
	let defaultAmount = BigNumber.from(1000);
	let oneMonthLoanLength = BigNumber.from(2592000).sub(1);
	let oneYearInSeconds = BigNumber.from(31536000);

	let defaultValidationDeadline;

	let collectionAPR = BigNumber.from(1000);
	let collectionLTV = BigNumber.from(8000);

	let sodiumERC721Manager;
	let privatePool;
	let privatePoolFactory;
	let weth;
	let erc721mock;

	async function deployProtocolWrapper() {
		const { privatePoolFactory, sodiumERC721Manager, sodiumERC1155Manager, privatePool, walletFactory, registry, weth, erc721mock } =
			await deployProtocol(defaultFeeNumenator, defaultAuctionLength);

		return { privatePoolFactory, sodiumERC721Manager, sodiumERC1155Manager, privatePool, walletFactory, registry, weth, erc721mock };
	}

	async function setupRequest(
		loanLength = oneMonthLoanLength,
	) {
		const { bob } = await getNamedSigners();
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

		return requestId;
	}

	async function reservoirMessage(
		price,
		currency = constants.AddressZero,
		twapSeconds = 86400,
		collectionCollateral = erc721mock.address,
		kind = 1,
	) {
		const { oracle } = await getNamedSigners();

		const messageTypeHash = utils.keccak256(utils.toUtf8Bytes("Message(bytes32 id,bytes payload,uint256 timestamp)"));
		const collectionPriceByTokenHash = utils.keccak256(
			utils.toUtf8Bytes("ContractWideCollectionPrice(uint8 kind,uint256 twapSeconds,address contract)")
		);


		const messageTimestamp = await time.latest();
		const messagePayload = utils.defaultAbiCoder.encode(
			[
				"address", "uint256"
			],
			[currency, price]
		);
		const messageId = utils.keccak256(
			utils.defaultAbiCoder.encode(
				[
					"bytes32",
					"uint256",
					"uint256",
					"address"
				],
				[
					collectionPriceByTokenHash,
					kind,
					twapSeconds,
					collectionCollateral
				]
			)
		);

		const messageHash = utils.keccak256(
			utils.defaultAbiCoder.encode(
				[
					"bytes32",
					"bytes32",
					"bytes32",
					"uint256"
				],
				[
					messageTypeHash,
					messageId,
					utils.keccak256(messagePayload),
					messageTimestamp
				]

			)
		);

		const signedMessageHash = await oracle.signMessage(
			utils.arrayify(messageHash)
		)

		return {
			id: messageId,
			payload: messagePayload,
			timestamp: messageTimestamp,
			signature: signedMessageHash,
		};
	}

	async function createMetaContribution(
		requestId,
		sodiumERC721Manager,
		APR,
		totalFundsOffered,
		liquidityLimit
	) {
		const {
			alice,
			validator
		} = await getNamedSigners();

		const metaContribution = await makeMetaContribution(
			requestId,
			alice,
			sodiumERC721Manager,
			totalFundsOffered,
			liquidityLimit,
			APR
		)

		const latestBlockTimestamp = await time.latest();
		const validationDeadline = BigNumber.from(1000).add(latestBlockTimestamp);
		const validation = await getValidation(validator, validationDeadline, [metaContribution]);

		return {
			metaContribution, validation
		}
	}

	beforeEach(async function () {
		const protocolSetup = await loadFixture(deployProtocolWrapper);

		privatePoolFactory = protocolSetup.privatePoolFactory;
		sodiumERC721Manager = protocolSetup.sodiumERC721Manager;
		sodiumERC1155Manager = protocolSetup.sodiumERC1155Manager;
		privatePool = protocolSetup.privatePool;
		walletFactory = protocolSetup.walletFactory;
		registry = protocolSetup.registry;
		weth = protocolSetup.weth;
		erc721mock = protocolSetup.erc721mock;

		const latestBlockTimestamp = await time.latest();
		defaultValidationDeadline = BigNumber.from(1000).add(latestBlockTimestamp);
	});

	it("Should revert borrowFromPools because loan length is too long", async function () {
		const { bob } = await getNamedSigners();
		const longerLoanLengthThanAllowedByPool = oneMonthLoanLength.add(1000)
		const requestId = await setupRequest(defaultValidationDeadline, longerLoanLengthThanAllowedByPool);

		const poolRequest = [{
			pool: privatePool.address,
			amount: defaultAmount,
			oracleMessage: {
				id: "0x4163bce510ba405523529cf23054a8ff50e064fa158d7a8a76df334bfcfad6ef",
				payload: "0x00",
				timestamp: 1672061935,
				signature: "0x00"
			}
		}];

		await expect(sodiumERC721Manager.connect(bob).borrowFromPools(requestId, poolRequest))
			.revertedWith("Sodium: length is too long");
	})

	it("Should revert because borrow was not called by the manager", async function () {
		const { bob } = await getNamedSigners();

		expect(privatePool.connect(bob).borrow(
			constants.AddressZero,
			BigNumber.from(0),
			bob.address,
			BigNumber.from(1000),
			BigNumber.from(36000),
			"0x00"
		)).revertedWith("Sodium: manager only");
	})

	it("Should revert because collection is not supported", async function () {
		const { bob } = await getNamedSigners();
		const requestId = await setupRequest();

		const poolRequest = [{
			pool: privatePool.address,
			amount: defaultAmount,
			oracleMessage: {
				id: "0x4163bce510ba405523529cf23054a8ff50e064fa158d7a8a76df334bfcfad6ef",
				payload: "0x00",
				timestamp: 1672061935,
				signature: "0x00"
			},
		}];

		await expect(sodiumERC721Manager.connect(bob).borrowFromPools(requestId, poolRequest))
			.revertedWith("Sodium: collection is not supported");
	})

	it("Should set terms for collection", async function () {
		const { poolOwner } = await getNamedSigners();
		const terms = {
			APR: collectionAPR,
			LTV: collectionLTV,
		}

		await privatePool.connect(poolOwner).setTermsForCollection([], [erc721mock.address], [terms])

		const termsAddedFilter = await privatePool.filters.PoolBorrowingTermsAdded();
		const termsAddedEvent = await privatePool.queryFilter(termsAddedFilter);

		expect(termsAddedEvent[0].args.collections[0]).equals(erc721mock.address)
		expect(termsAddedEvent[0].args.borrowingTerms[0].APR).equals(terms.APR)
		expect(termsAddedEvent[0].args.borrowingTerms[0].LTV).equals(terms.LTV)
	});

	it("Should be reverted because offChainData is not signed by the oracle", async function () {
		const { poolOwner, bob } = await getNamedSigners();
		const requestId = await setupRequest();

		await privatePool.connect(poolOwner).setTermsForCollection([], [erc721mock.address], [{
			APR: collectionAPR,
			LTV: collectionLTV,
		}])

		const poolRequest = [{
			pool: privatePool.address,
			amount: defaultAmount,
			oracleMessage: {
				id: "0x4163bce510ba405523529cf23054a8ff50e064fa158d7a8a76df334bfcfad6ef",
				payload: "0x00",
				timestamp: 1672061935,
				signature: "0x00"
			},
		}];

		await expect(sodiumERC721Manager.connect(bob).borrowFromPools(requestId, poolRequest))
			.revertedWith("Sodium: payload is not signed by oracle");
	});

	it("Should be reverted because the currecny is different from ETH", async function () {
		const { poolOwner, bob } = await getNamedSigners();
		const requestId = await setupRequest();

		await privatePool.connect(poolOwner).setTermsForCollection([], [erc721mock.address], [{
			APR: collectionAPR,
			LTV: collectionLTV,
		}])

		const price = BigNumber.from(1000);
		const amount = BigNumber.from(1000);
		const currencyUSDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
		const message = await reservoirMessage(price, currencyUSDC);

		const poolRequest = [{
			pool: privatePool.address,
			amount: amount,
			oracleMessage: message,
		}];

		await expect(sodiumERC721Manager.connect(bob).borrowFromPools(requestId, poolRequest))
			.revertedWith("Sodium: currency should be ETH");
	});

	it("Should borrow from pool successfully", async function () {
		const { poolOwner, bob } = await getNamedSigners();
		const requestId = await setupRequest();

		await privatePool.connect(poolOwner).setTermsForCollection([], [erc721mock.address], [{
			APR: collectionAPR,
			LTV: collectionLTV,
		}])

		const price = BigNumber.from(1000);
		const amount = BigNumber.from(800);
		const message = await reservoirMessage(price);

		const poolRequest = [{
			pool: privatePool.address,
			amount: amount,
			oracleMessage: message,
		}];

		weth.transfer.whenCalledWith(bob.address, amount)
			.returns(true);

		await expect(sodiumERC721Manager.connect(bob).borrowFromPools(requestId, poolRequest))
			.emit(sodiumERC721Manager, "BorrowFromPoolMade")
			.withArgs(requestId, privatePool.address, amount, collectionAPR);
	});

	it("Should be reveted because amount is bigger than allowed to borrow", async function () {
		const { poolOwner, bob } = await getNamedSigners();
		const requestId = await setupRequest();

		await privatePool.connect(poolOwner).setTermsForCollection([], [erc721mock.address], [{
			APR: collectionAPR,
			LTV: collectionLTV,
		}])

		const price = BigNumber.from(1000);
		const amountBiggerThanAllowedToBorrow = BigNumber.from(820);
		const message = await reservoirMessage(price);

		const poolRequest = [{
			pool: privatePool.address,
			amount: amountBiggerThanAllowedToBorrow,
			oracleMessage: message,
		}];

		await expect(sodiumERC721Manager.connect(bob).borrowFromPools(requestId, poolRequest))
			.revertedWith("Sodium: liquidity limit passed");
	});

	it("Should borrow from pool successfully and make repayment", async function () {
		const { poolOwner, bob, treasury } = await getNamedSigners();
		const requestId = await setupRequest();

		await privatePool.connect(poolOwner).setTermsForCollection([], [erc721mock.address], [{
			APR: collectionAPR,
			LTV: collectionLTV,
		}])

		const price = BigNumber.from(1000);
		const amount = BigNumber.from(800);
		const message = await reservoirMessage(price);

		const poolRequest = [{
			pool: privatePool.address,
			amount: amount,
			oracleMessage: message,
		}];

		weth.transfer.whenCalledWith(bob.address, amount)
			.returns(true);

		await sodiumERC721Manager.connect(bob).borrowFromPools(requestId, poolRequest);

		const latestBlockTimestamp = await time.latest();
		const halfYear = oneMonthLoanLength.div(2);
		const halfYearLoanLEndDate = halfYear.add(latestBlockTimestamp);

		await time.increaseTo(halfYearLoanLEndDate);

		const { baseInterestMinusBaseFee, doubleBaseFee } = calculateInterestAndFee(
			amount,
			collectionAPR,
			halfYear,
			defaultFeeNumenator
		);

		const repaymentToPool = baseInterestMinusBaseFee + amount.toNumber() + doubleBaseFee;

		weth.transferFrom.whenCalledWith(bob.address, privatePool.address, baseInterestMinusBaseFee + amount.toNumber()).returns(true);
		weth.transferFrom.whenCalledWith(bob.address, treasury.address, doubleBaseFee).returns(true);

		await expect(sodiumERC721Manager.connect(bob).repay(requestId, repaymentToPool))
			.emit(sodiumERC721Manager, "RepaymentMade")
			.withArgs(requestId, privatePool.address, amount, baseInterestMinusBaseFee, doubleBaseFee);
	});

	it("Should be reverted on borrowFromPools because borrowed amount is bigger then allowedToBorrow", async function () {
		const { poolOwner, bob } = await getNamedSigners();
		const requestId = await setupRequest();

		await privatePool.connect(poolOwner).setTermsForCollection([], [erc721mock.address], [{
			APR: collectionAPR,
			LTV: collectionLTV,
		}])

		const price = BigNumber.from(1000);
		const amount = BigNumber.from(810);
		const message = await reservoirMessage(price);

		const poolRequest = [{
			pool: privatePool.address,
			amount: amount,
			oracleMessage: message,
		}];

		weth.transferFrom.whenCalledWith(privatePool.address, bob.address, amount)
			.returns(true);

		await expect(sodiumERC721Manager.connect(bob).borrowFromPools(requestId, poolRequest))
			.revertedWith("Sodium: liquidity limit passed");
	});

	it("Should borrow from pools and metalenders and check events", async function () {
		const { poolOwner, bob, alice } = await getNamedSigners();
		const requestId = await setupRequest();

		await privatePool.connect(poolOwner).setTermsForCollection([], [erc721mock.address], [{
			APR: collectionAPR,
			LTV: collectionLTV,
		}])

		const price = BigNumber.from(1000);
		const amountToBorrowFromPool = BigNumber.from(800);
		const amountToBorrowFromMetalenders = BigNumber.from(400);
		const message = await reservoirMessage(price);
		const APR = BigNumber.from(2000)
		const totalFundsOffered = BigNumber.from("1000")
		const liquidityLimit = BigNumber.from("1900")

		const poolRequest = [{
			pool: privatePool.address,
			amount: amountToBorrowFromPool,
			oracleMessage: message,
		}];

		weth.transfer.whenCalledWith(bob.address, amountToBorrowFromPool)
			.returns(true);

		weth.transferFrom.whenCalledWith(alice.address, bob.address, amountToBorrowFromMetalenders)
			.returns(true);

		const { metaContribution, validation } = await createMetaContribution(
			requestId,
			sodiumERC721Manager,
			APR,
			totalFundsOffered,
			liquidityLimit
		);
		const orderTypes = [1, 0];

		await sodiumERC721Manager.connect(bob)
			.borrowFromPoolsAndMetalenders(
				requestId,
				poolRequest,
				[metaContribution],
				validation,
				[amountToBorrowFromMetalenders],
				orderTypes
			);

		const borrowFromPoolFilter = sodiumERC721Manager.filters.BorrowFromPoolMade();
		const borrowFromMetaLendersFilter = sodiumERC721Manager.filters.FundsAdded();

		const borrowFromPoolEvent = await sodiumERC721Manager.queryFilter(borrowFromPoolFilter);
		const borrowFromMetalendersEvent = await sodiumERC721Manager.queryFilter(borrowFromMetaLendersFilter);

		const loanIdEventPool = borrowFromPoolEvent[0].args[0].toString();
		const lenderEventPool = borrowFromPoolEvent[0].args[1];
		const amountEventPool = borrowFromPoolEvent[0].args[2].toString();
		const aprEventPool = borrowFromPoolEvent[0].args[3].toString();

		const loanIdMetalenderEvent = borrowFromMetalendersEvent[0].args[0].toString();
		const lenderMetalenderEvent = borrowFromMetalendersEvent[0].args[1];
		const amountMetalenderEvent = borrowFromMetalendersEvent[0].args[2].toString();
		const aprMetalenderEvent = borrowFromMetalendersEvent[0].args[3].toString();

		expect(loanIdEventPool).equals(requestId);
		expect(lenderEventPool).equals(privatePool.address);
		expect(amountEventPool).equals(amountToBorrowFromPool);
		expect(aprEventPool).equals(collectionAPR);

		expect(loanIdMetalenderEvent).equals(requestId);
		expect(lenderMetalenderEvent).equals(alice.address);
		expect(amountMetalenderEvent).equals(amountToBorrowFromMetalenders);
		expect(aprMetalenderEvent).equals(APR);
	});

	it("Should not let a user different from the pool owner to make a bid, resolve, and purchase through pool", async function () {
		const { lucy } = await getNamedSigners();
		const requestId = await setupRequest();

		// TODO: move these declaration to the top of the describe block
		const bidSize = BigNumber.from(6000);
		const boostIndex = 1;

		await expect(privatePool.connect(lucy).bidERC721(requestId, bidSize, boostIndex))
			.revertedWith("Ownable: caller is not the owner");

		await expect(privatePool.connect(lucy).resolveAuctionERC721(requestId, bidSize))
			.revertedWith("Ownable: caller is not the owner");

		await expect(privatePool.connect(lucy).purchaseERC721(requestId, bidSize))
			.revertedWith("Ownable: caller is not the owner");
	});

	it("Should borrow from pools and make a bid throught the pool", async function () {
		const { poolOwner, bob } = await getNamedSigners();
		const requestId = await setupRequest();

		await privatePool.connect(poolOwner).setTermsForCollection([], [erc721mock.address], [{
			APR: collectionAPR,
			LTV: collectionLTV,
		}])

		const price = BigNumber.from(1000);
		const amount = BigNumber.from(800);
		const message = await reservoirMessage(price);

		const bidSize = BigNumber.from(6000);
		const boostIndex = 0;

		const poolRequest = [{
			pool: privatePool.address,
			amount: amount,
			oracleMessage: message,
		}];

		weth.transfer.whenCalledWith(bob.address, amount)
			.returns(true);

		await sodiumERC721Manager.connect(bob).borrowFromPools(requestId, poolRequest);

		const latestBlockTimestamp = await time.latest();
		const loanEndDate = oneMonthLoanLength.add(latestBlockTimestamp);

		await time.increaseTo(loanEndDate);

		weth.transferFrom.whenCalledWith(privatePool.address, sodiumERC721Manager.address, bidSize)
			.returns(true);

		const interestEarnedForOneMonethOfProvidingLiquidity = parseInt(((amount * collectionAPR / 10000) / oneYearInSeconds) * oneMonthLoanLength)
		const expectedBidWithBoost = bidSize.add(interestEarnedForOneMonethOfProvidingLiquidity).add(amount)

		weth.approve.whenCalledWith(sodiumERC721Manager.address, bidSize)
			.returns(true);


		await expect(privatePool.connect(poolOwner).bidERC721(requestId, bidSize, boostIndex))
			.to.emit(sodiumERC721Manager, "BidMade")
			.withArgs(requestId, privatePool.address, expectedBidWithBoost, 806, boostIndex)
	});

	it("Should make a purchase through pool", async function () {
		const { poolOwner, bob } = await getNamedSigners();
		const requestId = await setupRequest();

		await privatePool.connect(poolOwner).setTermsForCollection([], [erc721mock.address], [{
			APR: collectionAPR,
			LTV: collectionLTV,
		}]);

		const price = BigNumber.from(1000);
		const amount = BigNumber.from(800);
		const message = await reservoirMessage(price);

		const bidSize = BigNumber.from(6000);

		const poolRequest = [{
			pool: privatePool.address,
			amount: amount,
			oracleMessage: message,
		}];

		weth.transfer.whenCalledWith(bob.address, amount)
			.returns(true);

		await sodiumERC721Manager.connect(bob).borrowFromPools(requestId, poolRequest);

		const latestBlockTimestamp = await time.latest();
		const loanEndDate = oneMonthLoanLength.add(latestBlockTimestamp);

		await time.increaseTo(loanEndDate);

		weth.transferFrom.whenCalledWith(poolOwner.address, sodiumERC721Manager.address, bidSize)
			.returns(true);

		weth.approve.whenCalledWith(sodiumERC721Manager.address, bidSize)
			.returns(true);

		await expect(privatePool.connect(poolOwner).purchaseERC721(requestId, bidSize))
			.to.emit(sodiumERC721Manager, "PurchaseMade")
			.withArgs(requestId);

		expect(await erc721mock.balanceOf(poolOwner.address))
			.equals(1)
	});

	it("Should borrow from pools and resolve auction", async function () {
		const { poolOwner, bob } = await getNamedSigners();
		const requestId = await setupRequest();

		await privatePool.connect(poolOwner).setTermsForCollection([], [erc721mock.address], [{
			APR: collectionAPR,
			LTV: collectionLTV,
		}])

		const price = BigNumber.from(1000);
		const amount = BigNumber.from(800);
		const message = await reservoirMessage(price);

		const bidSize = BigNumber.from(6000);
		const boostIndex = 0;

		const poolRequest = [{
			pool: privatePool.address,
			amount: amount,
			oracleMessage: message,
		}];

		weth.transfer.whenCalledWith(bob.address, amount)
			.returns(true);

		await sodiumERC721Manager.connect(bob).borrowFromPools(requestId, poolRequest);

		const latestBlockTimestamp = await time.latest();
		const loanEndDate = oneMonthLoanLength.add(latestBlockTimestamp);
		await time.increaseTo(loanEndDate);

		weth.transferFrom.whenCalledWith(poolOwner.address, sodiumERC721Manager.address, bidSize)
			.returns(true);

		weth.approve.whenCalledWith(sodiumERC721Manager.address, bidSize)
			.returns(true);

		await privatePool.connect(poolOwner).bidERC721(requestId, bidSize, boostIndex)

		const auctionEndDate = loanEndDate.add(defaultAuctionLength);
		await time.increaseTo(auctionEndDate);

		weth.transfer.whenCalledWith(bob.address, bidSize)
			.returns(true);

		weth.approve.whenCalledWith(sodiumERC721Manager.address, bidSize)
			.returns(true);

		await expect(privatePool.connect(poolOwner).resolveAuctionERC721(requestId, bidSize))
			.to.emit(sodiumERC721Manager, "AuctionConcluded")
			.withArgs(requestId, privatePool.address);

		expect(await erc721mock.balanceOf(poolOwner.address)).equals(1)
	});

	it("Should borrow on request creation", async function () {
		const { bob, poolOwner } = await getNamedSigners();
		const tokenId = BigNumber.from(0);

		await erc721mock.connect(bob).mint(bob.address, tokenId);

		const price = BigNumber.from(1000);
		const amount = BigNumber.from(800);
		const message = await reservoirMessage(price);

		const poolRequest = [{
			pool: privatePool.address,
			amount: amount,
			oracleMessage: message,
		}];

		weth.transfer.whenCalledWith(bob.address, amount)
			.returns(true);

		await privatePool.connect(poolOwner).setTermsForCollection([], [erc721mock.address], [{
			APR: collectionAPR,
			LTV: collectionLTV,
		}])

		const { requestId, tx } = await makeERC721Request(
			bob,
			tokenId,
			oneMonthLoanLength,
			poolRequest,
			erc721mock,
			sodiumERC721Manager
		)

		await expect(tx).to.emit(sodiumERC721Manager, "BorrowFromPoolMade")
			.withArgs(requestId, privatePool.address, amount, collectionAPR);
	});

	it("Should deposit liquidity on pool creation", async function () {
		const { bob } = await getNamedSigners();
		const amount = BigNumber.from(800);

		weth.transferFrom.returns(true);

		await privatePoolFactory.connect(bob).createPrivatePoolWithDeposit(
			bob.address,
			oneMonthLoanLength,
			{
				collections: [erc721mock.address],
				fixedValues: [0],
				isWETHdeposit: true,
				amount: amount,

			},
			[{
				APR: collectionAPR,
				LTV: collectionLTV,
			}],
		)

		const poolCreated = await privatePoolFactory.filters.PrivatePoolCreated();
		const poolCreatedEvent = await privatePoolFactory.queryFilter(poolCreated);

		expect(poolCreatedEvent[1].args.owner).equals(bob.address);
		expect(poolCreatedEvent[1].args.collections[0]).equals(erc721mock.address);
		expect(poolCreatedEvent[1].args.borrowingTerms[0].APR).equals(collectionAPR);
		expect(poolCreatedEvent[1].args.borrowingTerms[0].LTV).equals(collectionLTV);
		expect(poolCreatedEvent[1].args.amount).equals(amount)
	});

	it("Borrow from the same pool with the same collateral should be reverted if ltv surpassed", async function () {
		const { poolOwner, bob, alice, validator } = await getNamedSigners();
		const requestId = await setupRequest();

		await privatePool.connect(poolOwner).setTermsForCollection([], [erc721mock.address], [{
			APR: collectionAPR,
			LTV: collectionLTV,
		}])

		const price = BigNumber.from(1000);
		const amount = BigNumber.from(400);
		const message = await reservoirMessage(price);

		const poolRequest = [
			{
				pool: privatePool.address,
				amount: amount,
				oracleMessage: message,
			},
			{
				pool: privatePool.address,
				amount: amount,
				oracleMessage: message,
			}
		];

		weth.transfer.whenCalledWith(bob.address, amount)
			.returns(true);

		await sodiumERC721Manager.connect(bob).borrowFromPools(requestId, poolRequest)


		const latestBlockTimestamp = await time.latest();
		const validationDeadline = BigNumber.from(1000).add(latestBlockTimestamp);

		const metaContribution = await makeMetaContribution(
			requestId,
			alice,
			sodiumERC721Manager,
			BigNumber.from("10000000"),
			BigNumber.from("190000000"),
			collectionAPR
		)

		const validation = await getValidation(validator, validationDeadline, [metaContribution]);
		await sodiumERC721Manager.connect(bob).borrowFromMetaLenders(requestId, [metaContribution], [amount], validation)


	});

	it("Borrow from the same pool with the same collateral should be reverted if ltv surpassed", async function () {
		const { poolOwner, bob } = await getNamedSigners();
		const requestId = await setupRequest();

		await privatePool.connect(poolOwner).setTermsForCollection([], [erc721mock.address], [{
			APR: collectionAPR,
			LTV: collectionLTV,
		}])

		const price = BigNumber.from(1000);
		const amount = BigNumber.from(800);
		const message = await reservoirMessage(price);

		const poolRequest = [
			{
				pool: privatePool.address,
				amount: amount,
				oracleMessage: message,
			},
			{
				pool: privatePool.address,
				amount: amount,
				oracleMessage: message,
			}
		];

		weth.transfer.whenCalledWith(bob.address, amount)
			.returns(true);

		await expect(sodiumERC721Manager.connect(bob).borrowFromPools(requestId, poolRequest))
			.revertedWith("Sodium: pool ltv exceeded")
	});

	it("Should borrow from pool successfully, make repayment, and borrow against the collateral again", async function () {
		const { poolOwner, bob, treasury } = await getNamedSigners();
		const requestId = await setupRequest();

		await privatePool.connect(poolOwner).setTermsForCollection([], [erc721mock.address], [{
			APR: collectionAPR,
			LTV: collectionLTV,
		}])

		const price = BigNumber.from(1000);
		const amount = BigNumber.from(800);
		const message = await reservoirMessage(price);

		let poolRequest = [{
			pool: privatePool.address,
			amount: amount,
			oracleMessage: message,
		}];

		weth.transfer.whenCalledWith(bob.address, amount)
			.returns(true);

		await sodiumERC721Manager.connect(bob).borrowFromPools(requestId, poolRequest);

		const latestBlockTimestamp = await time.latest();
		const halfYear = oneMonthLoanLength.div(2);
		const halfYearLoanLEndDate = halfYear.add(latestBlockTimestamp);

		await time.increaseTo(halfYearLoanLEndDate);

		const { baseInterestMinusBaseFee, doubleBaseFee } = calculateInterestAndFee(
			amount,
			collectionAPR,
			halfYear,
			defaultFeeNumenator
		);

		const repaymentToPool = baseInterestMinusBaseFee + amount.toNumber() + doubleBaseFee;

		weth.transferFrom.whenCalledWith(bob.address, privatePool.address, baseInterestMinusBaseFee + amount.toNumber()).returns(true);
		weth.transferFrom.whenCalledWith(bob.address, treasury.address, doubleBaseFee).returns(true);


		await expect(sodiumERC721Manager.connect(bob).repay(requestId, repaymentToPool))
			.emit(sodiumERC721Manager, "RepaymentMade")
			.withArgs(requestId, privatePool.address, amount, baseInterestMinusBaseFee, doubleBaseFee);


		const erc721Request = await makeERC721Request(
			bob,
			BigNumber.from(0),
			oneMonthLoanLength,
			[],
			erc721mock,
			sodiumERC721Manager
		);

		const renewedMessage = await reservoirMessage(price);
		const poolRequestNew = [{
			pool: privatePool.address,
			amount: amount,
			oracleMessage: renewedMessage,
		}];

		await expect(sodiumERC721Manager.connect(bob).
			borrowFromPools(erc721Request.requestId, poolRequestNew))
			.emit(sodiumERC721Manager, "BorrowFromPoolMade")

	});
});