const { ethers: {
	BigNumber,
	getNamedSigners,
}
} = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployProtocol, makeERC721Request } = require("../helpers");
const { expect } = require("chai");

describe("Wallet", function () {
	const feeNumenator = BigNumber.from("50");
	let auctionLength = BigNumber.from("3600");

	let sodiumERC721Manager;
	let erc721mock;

	async function deployProtocolWrapper() {
		const { sodiumERC721Manager, sodiumERC1155Manager, walletFactory, registry, weth, erc721mock } =
			await deployProtocol(feeNumenator, auctionLength);

		return { sodiumERC721Manager, sodiumERC1155Manager, walletFactory, registry, weth, erc721mock };
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

	it("Should transfer ERC721 collateral to manager", async function () {
		const { bob } = await getNamedSigners();
		const tokenId = 0;
		await erc721mock.connect(bob).mint(bob.address, tokenId);

		await makeERC721Request(
			bob,
			tokenId,
			auctionLength,
			[],
			erc721mock,
			sodiumERC721Manager
		);

		const walletAddress = await sodiumERC721Manager.eoaToWallet(bob.address);

		expect(await erc721mock.balanceOf(walletAddress))
			.equal(1);
	})
})