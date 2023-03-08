const {
	ethers, upgrades: {
		deployProxy
	}
} = require("hardhat");

async function main() {
	const [deployer, bob] = await ethers.getSigners();

	console.log(`Deploying the protocol with ${deployer.address}`);

	const erc20Name = "Sodium ERC20 Mock";
	const erc20Symbol = "SM";
	const sodiumPassName = "SodiumPass";
	const sodiumPassSymbol = "SP";
	const erc721MockName = "erc721Mock";
	const erc721MockSymbol = "SM";

	const ERC721Mock = await ethers.getContractFactory("ERC721Mock");
	const ERC1155Mock = await ethers.getContractFactory("ERC1155Mock");
	const ERC721Manager = await ethers.getContractFactory("SodiumERC721Manager");
	const ERC1155Manager = await ethers.getContractFactory("SodiumERC1155Manager");
	const Wallet = await ethers.getContractFactory("SodiumWallet");
	const WalletFactory = await ethers.getContractFactory("SodiumWalletFactory");
	const Registry = await ethers.getContractFactory("SodiumRegistry");
	const Pool = await ethers.getContractFactory("SodiumPrivatePool");
	const PrivatePoolFactory = await ethers.getContractFactory("SodiumPrivatePoolFactory");
	const SodiumFreePool = await ethers.getContractFactory("SodiumFreePool");
	const SodiumPass = await ethers.getContractFactory("SodiumPass");
	const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
	console.log("Deploying with: ", deployer.address)

	const erc20Mock = await ERC20Mock.deploy("TestToken", "TT");
	const floorPriceLifetime = 86400;
	const loanLength = 86400;
	const feeInBasisPoints = 500;
	const weth = erc20Mock.address;
	const oracle = bob.address;

	const sodiumPass = await SodiumPass.deploy(sodiumPassName, sodiumPassSymbol);
	console.log("SodiumPass address:", sodiumPass.address);

	const registry = await Registry.deploy();
	console.log("Registry address:", registry.address);

	const walletInstance = await Wallet.deploy();
	console.log("Wallet instance address:", walletInstance.address);

	const privatePoolInstance = await Pool.deploy();
	console.log("Private pool instance address:", privatePoolInstance.address);

	const walletFactory = await WalletFactory.deploy(walletInstance.address, registry.address);
	console.log("Wallet Factory address:", walletFactory.address);

	// TODO: fix unsafe allow
	const erc721Manager = await deployProxy(
		ERC721Manager,
		[
			"Sodium ERC721 Manager",
			"1.0",
			feeInBasisPoints,
			loanLength,
			walletFactory.address,
			weth,
			deployer.address,
			deployer.address
		],
		{
			unsafeAllow: ["delegatecall"]
		}
	);
	console.log("ERC721 Manager address:", erc721Manager.address);

	// TODO: fix unsafe allow
	const erc1155Manager = await deployProxy(
		ERC1155Manager,
		[
			"Sodium ERC1155 Manager",
			"1.0",
			feeInBasisPoints,
			loanLength,
			walletFactory.address,
			weth,
			deployer.address,
			deployer.address
		],
		{
			unsafeAllow: ["delegatecall"]
		}
	);
	console.log("ERC1155 Manager address:", erc1155Manager.address);

	const LTV = 8000;
	const APR = 1000;

	const privatePoolFactory = await PrivatePoolFactory.deploy(
		privatePoolInstance.address,
		erc721Manager.address,
		erc1155Manager.address,
		weth
	);
	console.log("PoolFactory address:", privatePoolFactory.address);

	await privatePoolFactory.connect(deployer).createPrivatePool(
		oracle,
		floorPriceLifetime,
		[],
		[],
		[]
	);

	const sodiumFreePool = await SodiumFreePool.deploy(
		{
			sodiumPass: sodiumPass.address,
			oracle: oracle,
			manager721: erc721Manager.address,
			manager1155: erc1155Manager.address,
			weth: weth
		},
		floorPriceLifetime,
		[], [], []
	)
	console.log("SodiumFreePool address:", sodiumFreePool.address);

	const poolCreatedFilter = privatePoolFactory.filters.PrivatePoolCreated();
	const privatePoolCreatedEvent = await privatePoolFactory.queryFilter(poolCreatedFilter);
	const privatePoolAddress = privatePoolCreatedEvent[0].args.privatePool;

	console.log("Pool address:", privatePoolAddress);
	console.log("Pool's owner address:", bob.address);
	console.log("Oracle address:", oracle);
	console.log("SodiumPass address:", sodiumPass.address);
	console.log("WETHMock address:", weth);
}

main().catch((error) => {
	throw new Error(error);
});
