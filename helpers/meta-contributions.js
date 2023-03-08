const { time } = require("@nomicfoundation/hardhat-network-helpers");

// Create lender meta-contribution
// `available` is the total liqudity offered by the lender in the meta-contribution
// The borrower may add up to `available` => provided that total loan liquidity does not surpass their `liquidityLimit`
const makeMetaContribution = async (
  id,
  lender,
  manager,
  available,
  APR,
  liquidityLimit,
  version = "1.0"
) => {
  // EIP712 domain
  const domain = {
    name: "Sodium ERC721 Manager",
    version: version,
    chainId: 31337,
    verifyingContract: manager.address,
  };

  // Lender signs contribution terms following EIP712
  const types = {
    MetaContribution: [
      {
        name: "id",
        type: "uint256",
      },
      {
        name: "available",
        type: "uint256",
      },
      {
        name: "APR",
        type: "uint256",
      },
      {
        name: "liquidityLimit",
        type: "uint256",
      },
      {
        name: "nonce",
        type: "uint256",
      },
    ],
  };

  const nonce = await manager.nonces(id, lender.address);

  const values = {
    id: id,
    available: available,
    APR: APR,
    liquidityLimit: liquidityLimit,
    nonce: nonce,
  };

  const signature = await lender._signTypedData(domain, types, values);
  const splitSignature = ethers.utils.splitSignature(signature);

  // Use split signatures to create Sodium meta-contribution
  const metaContribution = {
    r: splitSignature.r,
    s: splitSignature.s,
    v: splitSignature.v,
    available: available,
    APR: APR,
    liquidityLimit: liquidityLimit,
    nonce: nonce,
  };

  return metaContribution;
};

// Returns a signature of one or more meta-contributions made by a validator
// Used to verify that meta-contributions brought on-chain have not been withdrawn
const getValidation = async (validator, deadline, metaContributions) => {
  const encoding = ethers.utils.defaultAbiCoder.encode(
    [
      "uint256",
      "tuple(bytes32 r, bytes32 s, uint8 v, uint256 available, uint256 APR, uint256 liquidityLimit, uint256 nonce)[]",
    ],
    [deadline, metaContributions]
  );

  const hash = ethers.utils.keccak256(encoding);

  // Sign with validator
  const signature = await validator.signMessage(ethers.utils.arrayify(hash));
  const splitSignature = ethers.utils.splitSignature(signature);

  return {
    deadline: deadline,
    v: splitSignature.v,
    r: splitSignature.r,
    s: splitSignature.s,
  };
};

// Setup and create one or more meta-contributions
const prepareMetaContributions = async (
  metaLenders,
  id,
  manager,
  currency,
  terms,
  validator
) => {
  const metaContributions = await Promise.all(
    metaLenders.map(async (lender, i) => {
      return makeMetaContribution(
        id,
        lender,
        manager,
        terms[i].available,
        terms[i].APR,
        terms[i].liquidityLimit
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

  await Promise.all(
    metaLenders.map(async (lender, i) => {
      await currency
        .mint(lender.address, terms[i].available)
        .then(() =>
          currency.connect(lender).approve(manager.address, terms[i].available)
        );
    })
  );

  return { metaContributions, validation };
};

module.exports = {
  makeMetaContribution,
  getValidation,
  prepareMetaContributions,
};
