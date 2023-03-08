// SPDX-License-Identifier: MIT
pragma solidity ^0.8.16;

import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract SodiumPass is ERC721 {
    constructor(string memory name, string memory symbol) ERC721(name, symbol) {}

    function mint(address to, uint256 id) public {
        _mint(to, id);
    }

    function _transfer(
        address,
        address,
        uint256
    ) internal pure override {
        revert("Sodium: transfer is not suppoted");
    }
}
