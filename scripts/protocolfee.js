const {
	ethers, upgrades: {
		deployProxy
	}
} = require("hardhat");

async function main() {
	const [deployer, bob] = await ethers.getSigners();

	console.log("Deploying the protocol... ");

	const ERC721Manager = await ethers.getContractFactory("SodiumERC721Manager");
	const ERC1155Manager = await ethers.getContractFactory("SodiumERC1155Manager");

	const feeInBasisPoints = 500;

	const erc721Manager = "0xa7761e1cfC5aBA42a3cf619549B1053d2b9Caa9f"
	const erc1155Manager = "0xd098C52b770C552067FEcfe4676ca53333A361cB"


	const erc1155TestnetContract = await ERC1155Manager.attach(erc1155Manager);
	const erc721TestnetContract = await ERC721Manager.attach(erc721Manager);


	await erc1155TestnetContract.setFee(feeInBasisPoints);
	await erc721TestnetContract.setFee(feeInBasisPoints);
}

main().catch((error) => {
	throw new Error(error);
});
