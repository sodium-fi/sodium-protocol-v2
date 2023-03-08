const { ethers: {
	BigNumber,
	getNamedSigners,
	utils
} } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployProtocol, makeERC721Request, makeMetaContribution, getValidation } = require("../helpers");
const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Borrow", function () {
	const feeNumenator = BigNumber.from("50");
	let auctionLength = BigNumber.from("3600");
	let amount = BigNumber.from(2000);

	let sodiumERC721Manager;
	let sodiumERC1155Manager;
	let weth;
	let erc721mock;
	let erc1155mock;

	async function deployProtocolWrapper() {
		const { sodiumERC721Manager, sodiumERC1155Manager, walletFactory, registry, weth, erc721mock, erc1155mock } =
			await deployProtocol(feeNumenator, auctionLength);

		return { sodiumERC721Manager, sodiumERC1155Manager, walletFactory, registry, weth, erc721mock, erc1155mock };
	}

	async function setupRequest(
		APR = BigNumber.from(2000),
		totalFundsOffered = BigNumber.from("10000000"),
		liquidityLimit = BigNumber.from("190000000")
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
			auctionLength,
			[],
			erc721mock,
			sodiumERC721Manager
		);

		const latestBlockTimestamp = await time.latest();
		const validationDeadline = BigNumber.from(1000).add(latestBlockTimestamp);

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
		erc1155mock = protocolSetup.erc1155mock;
	});

	describe("Metalenders", async function () {
		it("Should transfer ERC721 collateral to manager", async function () {
			const { bob } = await getNamedSigners();
			const tokenId = 0;
			await erc721mock.connect(bob).mint(bob.address, tokenId);

			const { requestId, tx } = await makeERC721Request(
				bob,
				tokenId,
				auctionLength,
				[],
				erc721mock,
				sodiumERC721Manager
			);

			await expect(tx).to.emit(sodiumERC721Manager, "RequestMade")
				.withArgs(
					requestId,
					bob.address,
					erc721mock.address,
					tokenId,
					auctionLength,
				)
		})

		it("Should transfer ERC721 collateral to manager and withdraw it", async function () {
			const { bob } = await getNamedSigners();
			const tokenId = 0;
			await erc721mock.connect(bob).mint(bob.address, tokenId);

			const { requestId } = await makeERC721Request(
				bob,
				tokenId,
				auctionLength,
				[],
				erc721mock,
				sodiumERC721Manager
			);

			await expect(sodiumERC721Manager.connect(bob).withdraw(requestId))
				.to.emit(sodiumERC721Manager, "RequestWithdrawn")
				.withArgs(
					requestId,
				)
			expect(await erc721mock.balanceOf(bob.address)).equals(1)
		})

		it("Should transfer ERC1155 collateral to manager and withdraw it", async function () {
			const { bob } = await getNamedSigners();

			const tokenId = BigNumber.from(0);
			await erc1155mock.connect(bob).mint(bob.address, tokenId);

			let encoded = utils.defaultAbiCoder.encode(
				[
					"uint",
					"tuple(address pool, uint256 amount, bytes oracleMessage)[]"
				],
				[
					auctionLength,
					[]
				]
			);
			const amount1155 = 1;

			await erc1155mock.connect(bob).safeTransferFrom(bob.address, sodiumERC1155Manager.address, tokenId, amount1155, encoded);

			const requestMadeEvent = await sodiumERC1155Manager.queryFilter(
				sodiumERC721Manager.filters.RequestMade()
			)

			const requestId = requestMadeEvent[0].args.id.toString();

			await expect(sodiumERC1155Manager.connect(bob).withdraw(requestId))
				.to.emit(sodiumERC1155Manager, "RequestWithdrawn")
				.withArgs(requestId)

			expect(await erc1155mock.balanceOf(bob.address, tokenId)).equals(1)
		})

		it("Should fail to withdraw because there is an unpaid lender", async function () {
			const { bob, alice } = await getNamedSigners();
			const { requestId, metaContribution, validation } = await setupRequest();

			weth.transferFrom.whenCalledWith(alice.address, bob.address, amount)
				.returns(true);

			await expect(sodiumERC721Manager.connect(bob).borrowFromMetaLenders(requestId, [metaContribution], [amount], validation))
				.emit(sodiumERC721Manager, "FundsAdded").
				withArgs(requestId, alice.address, amount, metaContribution.APR);

			await expect(sodiumERC721Manager.connect(bob).withdraw(requestId))
				.revertedWith("Sodium: there is unpaid lender");
		})

		it("Should fail to withdraw because msg.sender is not borrower", async function () {
			const { bob, alice } = await getNamedSigners();
			const { requestId } = await setupRequest();

			weth.transferFrom.whenCalledWith(alice.address, bob.address, amount)
				.returns(true);

			await expect(sodiumERC721Manager.connect(alice).withdraw(requestId))
				.revertedWith("Sodium: msg.sender is not borrower");
		})

		it("Should transfer ERC721 collateral to manager and execute borrowFromMetalenders and be reverted beacuse of a different msg.sender", async function () {
			const { bob, alice, validator } = await getNamedSigners();
			const tokenId = BigNumber.from(0);

			await erc721mock.connect(bob).mint(bob.address, tokenId);

			const { requestId } = await makeERC721Request(
				bob,
				tokenId,
				auctionLength,
				[],
				erc721mock,
				sodiumERC721Manager
			);

			const validationDeadline = BigNumber.from(1000);
			const APR = BigNumber.from(2000);
			const amount = BigNumber.from(2000);

			const metaContribution = await makeMetaContribution(
				requestId,
				bob,
				sodiumERC721Manager,
				BigNumber.from("10000000"),
				BigNumber.from("100000000"),
				APR
			)

			const validation = await getValidation(validator, validationDeadline, [metaContribution])

			await expect(sodiumERC721Manager.connect(alice).borrowFromMetaLenders(requestId, [metaContribution], [amount], validation))
				.revertedWith("Sodium: msg.sender is not borrower");
		})

		it("Should transfer ERC721 collateral to manager and execute borrowFromMetalenders and be reverted because validation deadline has been exceeded", async function () {
			const { bob, validator } = await getNamedSigners();

			const tokenId = BigNumber.from(0);
			auctionLength = BigNumber.from(2);

			await erc721mock.connect(bob).mint(bob.address, tokenId);

			const { requestId } = await makeERC721Request(
				bob,
				tokenId,
				auctionLength,
				[],
				erc721mock,
				sodiumERC721Manager
			);

			const validationDeadline = BigNumber.from(1000);
			const APR = BigNumber.from(2000);
			const amount = BigNumber.from(2000);

			const metaContribution = await makeMetaContribution(
				requestId,
				bob,
				sodiumERC721Manager,
				BigNumber.from("10000000"),
				BigNumber.from("100000000"),
				APR
			)

			const validation = await getValidation(validator, validationDeadline, [metaContribution])
			await expect(sodiumERC721Manager.connect(bob).borrowFromMetaLenders(requestId, [metaContribution], [amount], validation))
				.revertedWith("Sodium: validation deadline exceeded");
		})

		it("Should transfer ERC721 collateral to manager and execute borrowFromMetalenders and be reverted because validation is not signed by validator", async function () {
			const { bob, alice } = await getNamedSigners();

			const tokenId = BigNumber.from(0);
			auctionLength = BigNumber.from(2);

			await erc721mock.connect(bob).mint(bob.address, tokenId);

			const { requestId } = await makeERC721Request(
				bob,
				tokenId,
				auctionLength,
				[],
				erc721mock,
				sodiumERC721Manager
			);

			const validationDeadline = BigNumber.from(1000);
			const APR = BigNumber.from(2000);
			const amount = BigNumber.from(2000);

			const metaContribution = await makeMetaContribution(
				requestId,
				bob,
				sodiumERC721Manager,
				BigNumber.from("10000000"),
				BigNumber.from("100000000"),
				APR
			)

			const validation = await getValidation(alice, validationDeadline, [metaContribution])
			await expect(sodiumERC721Manager.connect(bob).borrowFromMetaLenders(requestId, [metaContribution], [amount], validation))
				.revertedWith("Sodium: signer is not validator");
		})

		it("Should transfer ERC721 collateral to manager and execute borrowFromMetalenders successfully", async function () {
			const { bob, alice } = await getNamedSigners();
			const { requestId, metaContribution, validation } = await setupRequest();

			weth.transferFrom.whenCalledWith(alice.address, bob.address, amount)
				.returns(true);

			await expect(sodiumERC721Manager.connect(bob).borrowFromMetaLenders(requestId, [metaContribution], [amount], validation))
				.emit(sodiumERC721Manager, "FundsAdded").
				withArgs(requestId, alice.address, amount, metaContribution.APR);
		})

		it("Should execute borrowFromMetalenders and be reverted because amount is bigger than totalFundsOffered", async function () {
			const { bob } = await getNamedSigners();
			const { requestId, metaContribution, validation } = await setupRequest();

			const amountBiggerThanTotalFundsOffered = metaContribution.totalFundsOffered.add(1000)
			await expect(sodiumERC721Manager.connect(bob).borrowFromMetaLenders(requestId, [metaContribution], [amountBiggerThanTotalFundsOffered], validation))
				.revertedWith("Sodium: amount is bigger than offered");
		})

		it("Should be reverted because liquidityLimit is exceeded", async function () {
			const { bob, alice, lucy, validator } = await getNamedSigners();
			const { requestId, metaContribution, validation } = await setupRequest();

			const APR = BigNumber.from(2000)
			const totalFundsOffered = BigNumber.from("1000")
			const liquidityLimit = BigNumber.from("1900")
			const latestBlockTimestamp = await time.latest();
			const validationDeadline = BigNumber.from(1000).add(latestBlockTimestamp);
			const amount = BigNumber.from(1000);

			const secondMetaTransaction = await makeMetaContribution(
				requestId,
				lucy,
				sodiumERC721Manager,
				totalFundsOffered,
				liquidityLimit,
				APR
			)

			const secondValidation = await getValidation(validator, validationDeadline, [secondMetaTransaction]);

			weth.transferFrom.whenCalledWith(alice.address, bob.address, amount)
				.returns(true);

			await sodiumERC721Manager.connect(bob).borrowFromMetaLenders(requestId, [metaContribution], [amount], validation)
			await expect(sodiumERC721Manager.connect(bob).borrowFromMetaLenders(requestId, [secondMetaTransaction], [amount], secondValidation))
				.revertedWith("Sodium: contribution limit exceeded");
		})

		it("Should be reverted because nonce is repeated", async function () {
			const { bob, alice, validator } = await getNamedSigners();
			const { requestId, metaContribution, validation } = await setupRequest();

			const APR = BigNumber.from(2000)
			const totalFundsOffered = BigNumber.from("1000")
			const liquidityLimit = BigNumber.from("19000")
			const latestBlockTimestamp = await time.latest();
			const validationDeadline = BigNumber.from(1000).add(latestBlockTimestamp);
			const amount = BigNumber.from(1000);

			const secondMetaTransaction = await makeMetaContribution(
				requestId,
				alice,
				sodiumERC721Manager,
				totalFundsOffered,
				liquidityLimit,
				APR
			)

			const secondValidation = await getValidation(validator, validationDeadline, [secondMetaTransaction]);

			weth.transferFrom.whenCalledWith(alice.address, bob.address, amount)
				.returns(true);

			await sodiumERC721Manager.connect(bob).borrowFromMetaLenders(requestId, [metaContribution], [amount], validation)
			await expect(sodiumERC721Manager.connect(bob).borrowFromMetaLenders(requestId, [secondMetaTransaction], [amount], secondValidation))
				.revertedWith("Sodium: nonce is repeated");
		})
	})
});