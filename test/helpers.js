const { smock } = require("@defi-wonderland/smock");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
	ethers: {
		getNamedSigners,
		BigNumber,
		utils,
		constants
	}, ethers,
	upgrades
} = require("hardhat");

async function deployProtocol(feeNumerator, auctionLength) {
	// TODO: sometimes smock failes to return data for corresponding
	// TODO: input so it needs to be fixed or run multipple time
	// TODO: in order to make sure that the tests are okay
	const weth = await smock.fake("IERC20");
	const defaultFloorPriceLifetime = BigNumber.from(36000);

	const {
		deployer,
		oracle,
		validator,
		treasury,
		poolOwner
	} = await getNamedSigners();

	const LTV = 8000;
	const APR = 1000;

	const ERC721Manager = await ethers.getContractFactory("SodiumERC721Manager");
	const ERC1155Manager = await ethers.getContractFactory("SodiumERC1155Manager");

	const Wallet = await ethers.getContractFactory("SodiumWallet");
	const WalletFactory = await ethers.getContractFactory("SodiumWalletFactory");
	const PrivatePoolFactory = await ethers.getContractFactory("SodiumPrivatePoolFactory");
	const Registry = await ethers.getContractFactory("SodiumRegistry");
	const PirvatePool = await ethers.getContractFactory("SodiumPrivatePool");

	const walletImplementation = await Wallet.connect(deployer).deploy();
	const registry = await Registry.connect(deployer).deploy();
	const walletFactory = await WalletFactory.connect(deployer).deploy(walletImplementation.address, registry.address);


	const ERC1155Mock = await ethers.getContractFactory("ERC1155Mock");
	const erc1155mock = await ERC1155Mock.connect(deployer).deploy("ERC1155URI");
	const ERC721Mock = await ethers.getContractFactory("ERC721Mock");
	const erc721mock = await ERC721Mock.connect(deployer).deploy("TestCollection", "TC");
	const privatePoolImpl = await PirvatePool.deploy();

	const sodiumERC721Manager = await upgrades.deployProxy(
		ERC721Manager,
		[
			"Sodium ERC721 Manager",
			"1.0",
			feeNumerator,
			auctionLength,
			walletFactory.address,
			weth.address,
			treasury.address,
			validator.address
		],
		{
			unsafeAllow: ["delegatecall"]
		}
	);

	const sodiumERC1155Manager = await upgrades.deployProxy(
		ERC1155Manager,
		[
			"Sodium ERC1155 Manager",
			"1.0",
			feeNumerator,
			auctionLength,
			walletFactory.address,
			weth.address,
			treasury.address,
			validator.address
		],
		{
			unsafeAllow: ["delegatecall"]
		}
	);

	const privatePoolFactory = await PrivatePoolFactory.deploy(privatePoolImpl.address, sodiumERC721Manager.address, sodiumERC1155Manager.address, weth.address);

	const tx = await privatePoolFactory.connect(poolOwner).createPrivatePool(
		oracle.address,
		defaultFloorPriceLifetime,
		["0x0000000000000000000000000000000000000001"],
		[
			{
				APR,
				LTV
			}
		],
		["0"]
	);

	await tx.wait();

	const poolCreatedFilter = privatePoolFactory.filters.PrivatePoolCreated();
	const privatePoolCreatedEvent = await privatePoolFactory.queryFilter(poolCreatedFilter);

	const privatePoolAddress = privatePoolCreatedEvent[0].args.privatePool;
	const privatePool = await ethers.getContractAt("SodiumPrivatePool", privatePoolAddress);

	return {
		privatePoolFactory,
		sodiumERC721Manager,
		sodiumERC1155Manager,
		privatePool,
		walletFactory,
		registry,
		weth,
		erc721mock,
		erc1155mock
	};
}

async function makeERC721Request(
	requester,
	tokenId,
	loanLength,
	borrowFromPoolRequests,
	erc721mock,
	manager
) {
	let encoded;
	if (borrowFromPoolRequests.length != 0) {
		let poolRequests = borrowFromPoolRequests.map((x) => {
			return {
				pool: x.pool,
				amount: x.amount,
				oracleMessage: {
					id: x.oracleMessage.id,
					payload: x.oracleMessage.payload,
					timestamp: x.oracleMessage.timestamp,
					signature: x.oracleMessage.signature
				},
			}
		})

		encoded = utils.defaultAbiCoder.encode(
			[
				"uint",
				"tuple(address pool, uint256 amount, tuple(bytes32 id, bytes payload, uint256 timestamp, bytes signature) oracleMessage)[]"
			],
			[
				loanLength,
				poolRequests
			]
		);
	} else {
		encoded = utils.defaultAbiCoder.encode(
			[
				"uint",
				"tuple(address pool, uint256 amount, bytes oracleMessage)[]"
			],
			[
				loanLength,
				borrowFromPoolRequests
			]
		);
	}

	const tx = await erc721mock.connect(requester)["safeTransferFrom(address,address,uint256,bytes)"](requester.address, manager.address, tokenId, encoded);

	const requestIdKeccak256 = utils.keccak256(
		utils.defaultAbiCoder.encode(
			["uint", "address", "uint"],
			[tokenId, erc721mock.address, (await time.latest())]
		)
	);

	const requestId = BigNumber.from(requestIdKeccak256);

	return { requestId, tx };
}

async function deployPrivatePool(owner, oracle, managers, maxLoanLength) {
	const Pool = await ethers.getContractFactory("SodiumPrivatePool");
	const pool = await Pool.connect(owner).deploy(oracle, managers, maxLoanLength);

	return pool;
}

// Create lender meta-contribution
// `available` is the total liqudity offered by the lender in the meta-contribution
// The borrower may add up to `available` => provided that total loan liquidity does not surpass their `liquidityLimit`
async function makeMetaContribution(
	id,
	lender,
	manager,
	totalFundsOffered,
	liquidityLimit,
	APR,
	version = "1.0"
) {
	// EIP712 domain
	const domain = {
		name: "Sodium ERC721 Manager",
		version,
		chainId: 31337,
		verifyingContract: manager.address
	};

	// Lender signs contribution terms following EIP712
	const types = {
		MetaContribution: [
			{
				name: "id",
				type: "uint256"
			},
			{
				name: "totalFundsOffered",
				type: "uint256"
			},
			{
				name: "APR",
				type: "uint256"
			},
			{
				name: "liquidityLimit",
				type: "uint256"
			},
			{
				name: "nonce",
				type: "uint256"
			}
		]
	};

	const nonce = await manager.nonces(id, lender.address);

	const values = {
		id,
		totalFundsOffered,
		APR,
		liquidityLimit,
		nonce
	};

	const signature = await lender._signTypedData(domain, types, values);
	const splitSignature = ethers.utils.splitSignature(signature);

	// Use split signatures to create Sodium meta-contribution
	const metaContribution = {
		r: splitSignature.r,
		s: splitSignature.s,
		v: splitSignature.v,
		totalFundsOffered,
		APR,
		liquidityLimit,
		nonce
	};

	return metaContribution;
}

async function getValidation(validator, deadline, metaContributions) {
	const encoding = ethers.utils.defaultAbiCoder.encode(
		[
			"uint256",
			"tuple(bytes32 r, bytes32 s, uint8 v, uint256 totalFundsOffered, uint256 APR, uint256 liquidityLimit, uint256 nonce)[]"
		],
		[deadline, metaContributions]
	);

	const hash = ethers.utils.keccak256(encoding);
	const signature = await validator.signMessage(ethers.utils.arrayify(hash));
	const splitSignature = ethers.utils.splitSignature(signature);

	return {
		deadline,
		v: splitSignature.v,
		r: splitSignature.r,
		s: splitSignature.s
	};
}

// Setup and create one or more meta-contributions
async function prepareMetaContributions(
	metaLenders,
	id,
	manager,
	validator,
	available,
	APR,
	liquidityLimit
) {
	const metaContributions = await Promise.all(
		metaLenders.map(async (lender, i) => {
			return makeMetaContribution(
				id,
				lender,
				manager,
				available[i],
				APR[i],
				liquidityLimit[i]
			);
		})
	);

	// Validate contributions
	const deadline = (await time.latest()) + 1000;
	const validation = await getValidation(
		validator,
		deadline,
		metaContributions
	);

	return { metaContributions, validation };
}

module.exports = {
	deployProtocol,
	makeERC721Request,
	deployPrivatePool,
	makeMetaContribution,
	getValidation,
	prepareMetaContributions
};
