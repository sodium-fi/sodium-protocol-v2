// SPDX-License-Identifier: MIT
pragma solidity ^0.8.16;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ISodiumPrivatePoolFactory} from "./interfaces/ISodiumPrivatePoolFactory.sol";
import {ISodiumPrivatePool} from "./interfaces/ISodiumPrivatePool.sol";

contract SodiumPrivatePoolFactory is ISodiumPrivatePoolFactory {
    address public implementation;
    address private weth;
    address public sodiumManagerERC721;
    address public sodiumManagerERC1155;

    constructor(
        address implementation_,
        address manager721_,
        address manager1155_,
        address weth_
    ) {
        implementation = implementation_;
        sodiumManagerERC721 = manager721_;
        sodiumManagerERC1155 = manager1155_;
        weth = weth_;
    }

    function createPrivatePool(
        address oracle_,
        uint128 floorPriceLifetime_,
        address[] calldata collections_,
        ISodiumPrivatePool.BorrowingTerms[] calldata borrowingTerms_,
        uint256[] calldata fixedValues_
    ) external returns (address) {
        address privatePool = Clones.clone(implementation);
        ISodiumPrivatePool(privatePool).initialize(
            oracle_,
            sodiumManagerERC721,
            sodiumManagerERC1155,
            weth,
            msg.sender,
            floorPriceLifetime_,
            collections_,
            borrowingTerms_,
            fixedValues_
        );

        emit PrivatePoolCreated(msg.sender, privatePool, collections_, borrowingTerms_, fixedValues_, 0);
        return privatePool;
    }

    function createPrivatePoolWithDeposit(
        address oracle_,
        uint128 floorPriceLifetime_,
        CollectionsFixedValuesAndDeposit calldata collectionsFixedValuesAndDeposit_,
        ISodiumPrivatePool.BorrowingTerms[] memory borrowingTerms_
    ) external payable returns (address) {
        address privatePool = Clones.clone(implementation);

        ISodiumPrivatePool(privatePool).initialize(
            oracle_,
            sodiumManagerERC721,
            sodiumManagerERC1155,
            weth,
            msg.sender,
            floorPriceLifetime_,
            collectionsFixedValuesAndDeposit_.collections,
            borrowingTerms_,
            collectionsFixedValuesAndDeposit_.fixedValues
        );

        if (collectionsFixedValuesAndDeposit_.isWETHdeposit) {
            bool sent = IERC20(weth).transferFrom(msg.sender, privatePool, collectionsFixedValuesAndDeposit_.amount);
            require(sent, "Sodium: failed to send");
        } else {
            require(collectionsFixedValuesAndDeposit_.amount == msg.value, "Sodium: amount differs from msg.value");

            (bool sent, ) = address(weth).call{value: collectionsFixedValuesAndDeposit_.amount}(
                abi.encodeWithSignature("deposit()")
            );
            require(sent, "Sodium: failed to send");

            sent = IERC20(weth).transfer(privatePool, collectionsFixedValuesAndDeposit_.amount);
            require(sent, "Sodium: failed to send");
        }

        emit PrivatePoolCreated(
            msg.sender,
            privatePool,
            collectionsFixedValuesAndDeposit_.collections,
            borrowingTerms_,
            collectionsFixedValuesAndDeposit_.fixedValues,
            collectionsFixedValuesAndDeposit_.amount
        );
        return privatePool;
    }
}
