const {
	ethers, upgrades: {
		deployProxy
	}
} = require("hardhat");

async function main() {
	const [deployer] = await ethers.getSigners();
	console.log("Deploying the protocol... ");

	const auctionLength = 86400;
	const feeInBasisPoints = 500;
	const floorPriceLifetime = 86400;
	const erc721ManagerName = "Sodium ERC721 Manager";
	const erc1155ManagerName = "Sodium ERC155 Manager";
	const weth = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
	const mainnetOwner = "0x7ee4Ac7436D3c07883e58609506bF9eB24008130";
	const version = "2.0";
	const treasury = "0x5B297c4d1eE2727db97D63f8b298c5422B13A652"
	const validator = "0xb0382B4fF05ec7b04bfae9C98aA4F891888BC3CB"
	const sodiumPass = "0xFEFe4EefF35e3F9488388dD56B645Cc90303B574"
	const oracle = "0xAeB1D03929bF87F69888f381e73FBf75753d75AF"
	const freePoolOwner = "0x6D1477b60f25697971cB9Cc195488F5a0Ed7aee2"

	const ERC721Manager = await ethers.getContractFactory("SodiumERC721Manager");
	const SodiumFreePool = await ethers.getContractFactory("SodiumFreePool");
	const ERC1155Manager = await ethers.getContractFactory("SodiumERC1155Manager");
	const Wallet = await ethers.getContractFactory("SodiumWallet");
	const WalletFactory = await ethers.getContractFactory("SodiumWalletFactory");
	const Registry = await ethers.getContractFactory("SodiumRegistry");
	const Pool = await ethers.getContractFactory("SodiumPrivatePool");
	const PrivatePoolFactory = await ethers.getContractFactory("SodiumPrivatePoolFactory");

	const registry = await Registry.deploy();
	const walletInstance = await Wallet.deploy();
	const privatePool = await Pool.deploy();
	const walletFactory = await WalletFactory.deploy(walletInstance.address, registry.address);

	const erc721Manager = await deployProxy(
		ERC721Manager,
		[
			erc721ManagerName,
			version,
			feeInBasisPoints,
			auctionLength,
			walletFactory.address,
			weth,
			treasury,
			validator
		],
		{
			kind: "uups",
		}
	);

	const erc1155Manager = await deployProxy(
		ERC1155Manager,
		[
			erc1155ManagerName,
			version,
			feeInBasisPoints,
			auctionLength,
			walletFactory.address,
			weth,
			treasury,
			validator
		],
		{
			kind: "uups",
		}
	);

	const privatePoolFactory = await PrivatePoolFactory.deploy(
		privatePool.address,
		erc721Manager.address,
		erc1155Manager.address,
		weth
	);

	const sodiumFreePool = await SodiumFreePool.deploy(
		{
			sodiumPass: sodiumPass,
			oracle: oracle,
			manager721: erc721Manager.address,
			manager1155: erc1155Manager.address,
			weth: weth
		},
		floorPriceLifetime,
		[], [], []
	)

	await sodiumFreePool.transferOwnership(freePoolOwner)
	await erc1155Manager.transferOwnership(mainnetOwner)
	await erc721Manager.transferOwnership(mainnetOwner)
	await registry.transferOwnership(mainnetOwner)

	console.log("Deploying with:", deployer.address);
	console.log("Registry address:", registry.address);
	console.log("Wallet instance address:", walletInstance.address);
	console.log("Wallet Factory address:", walletFactory.address);
	console.log("ERC721 Manager address:", erc721Manager.address);
	console.log("ERC1155 Manager address:", erc1155Manager.address);
	console.log("SodiumFreePool address:", sodiumFreePool.address);
	console.log("Pool factory address:", privatePoolFactory.address);
	console.log("WETH address:", weth);
}

main().catch((error) => {
	throw new Error(error);
});
