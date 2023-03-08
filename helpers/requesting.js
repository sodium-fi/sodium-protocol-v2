const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");

// Makes a loan request with an ERC721 token as collateral
const requestWithERC721 = async (
                    ERC721Manager,
                    borrower,
                    ERC721,
                    currency,
                    tokenId,
                    length,
                    pools,
                    amounts,
                    offChainDatas
) => {
                    // Mint NFT to the borrower
                    await ERC721.mint(borrower.address, tokenId);

                    const theo = 123;

                    // Encode request parameters
                    const requestParams = ethers.utils.defaultAbiCoder.encode(
                                        ["tuple(uint256,address,address[],uint256[],bytes[])"],
                                        [[length, currency.address, pools, amounts, offChainDatas]]
                    );

                    // Send token to the core with request parameters
                    const tx = await ERC721.connect(borrower)["safeTransferFrom(address,address,uint256,bytes)"](
                                        borrower.address,
                                        ERC721Manager.address,
                                        tokenId,
                                        requestParams
                    );

                    // Calculate loan ID
                    const timestamp = await time.latest();
                    const requestHashInput = ethers.utils.defaultAbiCoder.encode(
                                        ["uint256", "address", "uint256"],
                                        [tokenId, ERC721.address, timestamp]
                    );
                    const requestId = ethers.BigNumber.from(ethers.utils.keccak256(requestHashInput));

                    return { requestId, tx };
};

module.exports = {
                    requestWithERC721,
};
