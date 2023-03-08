// SPDX-License-Identifier: MIT
pragma solidity ^0.8.16;

import {ISodiumPrivatePool} from "./ISodiumPrivatePool.sol";

interface ISodiumPrivatePoolFactory {
    event PrivatePoolCreated(
        address indexed owner,
        address privatePool,
        address[] collections,
        ISodiumPrivatePool.BorrowingTerms[] borrowingTerms,
        uint256[] fixedValues,
        uint256 amount
    );

    /// @dev to avoid the stack is too deep error
    struct CollectionsFixedValuesAndDeposit {
        address[] collections;
        uint256[] fixedValues;
        bool isWETHdeposit;
        uint256 amount;
    }

    /// @notice Used  to create a private pool
    /// @param oracle_ oracle which is used to determine nft floor price
    /// @param floorPriceLifetime_ time after which floor price is considered to be expired
    /// @param collections_ array of collections which will be supported after a pool creation
    /// @param borrowingTerms_ array of terms which will be used for a corresponding collections in the collections_ array
    /// @param fixedValues_ array of fixed values which will be assigned after pool creation
    function createPrivatePool(
        address oracle_,
        uint128 floorPriceLifetime_,
        address[] calldata collections_,
        ISodiumPrivatePool.BorrowingTerms[] calldata borrowingTerms_,
        uint256[] calldata fixedValues_
    ) external returns (address);

    /// @notice Used  to create a private pool
    /// @param oracle_ oracle which is used to determine nft floor price
    /// @param floorPriceLifetime_ time after which floor price is considered to be expired
    /// @param collectionsFixedValuesAndDeposit_ array of collections with fixed values which will be supported after a pool creation
    /// @param borrowingTerms_ array of terms which will be used for a corresponding collections in the collections_ array
    function createPrivatePoolWithDeposit(
        address oracle_,
        uint128 floorPriceLifetime_,
        CollectionsFixedValuesAndDeposit calldata collectionsFixedValuesAndDeposit_,
        ISodiumPrivatePool.BorrowingTerms[] calldata borrowingTerms_
    ) external payable returns (address);
}
