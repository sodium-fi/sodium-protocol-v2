const { requestWithERC721 } = require("./requesting");
const { deployPrivatePool } = require("./deploying");
const { prepareMetaContributions } = require("./meta-contributions");

// Requests a loan with ERC721 collateral then calls `borrowFromMetaLendersAndPools`
const initiateERC721Loan = async (
    manager,
    borrower,
    ERC721,
    currency,
    tokenId,
    length,
    order,
    metaLenders,
    metaContributionTerms,
    pools,
    amounts,
    offChainDatas,
    validator
) => {
    const { requestId } = await requestWithERC721(manager, borrower, ERC721, currency, tokenId, length, [], [], []);

    const { metaContributions, validation } = await prepareMetaContributions(
        metaLenders,
        requestId,
        manager,
        currency,
        metaContributionTerms,
        validator
    );

    const poolAddresses = pools.map((pool) => pool.address);

    await manager
        .connect(borrower)
        .borrowFromMetaLendersAndPools(
            requestId,
            order,
            metaContributions,
            poolAddresses,
            amounts,
            validation,
            offChainDatas
        );

    return requestId;
};

// Deploys a private pool, sets terms for a collection, and deposits token liquidity
const setupPrivatePool = async (
    owner,
    oracle,
    managers,
    maxLoanLength,
    ERC20,
    deposit,
    ERC721,
    APR,
    liquidityLimit
) => {
    const managerAddresses = managers.map((manager) => manager.address);

    const pool = await deployPrivatePool(owner, oracle.address, managerAddresses, maxLoanLength);

    await ERC20.mint(pool.address, deposit);

    await pool.connect(owner).setCollectionTerms(ERC721.address, APR, liquidityLimit);

    return pool;
};

module.exports = {
    initiateERC721Loan,
    setupPrivatePool,
};
