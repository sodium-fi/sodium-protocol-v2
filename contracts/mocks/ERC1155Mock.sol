// SPDX-License-Identifier: MIT
pragma solidity ^0.8.16;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

// Mock ERC1155 contract for testing
contract ERC1155Mock is ERC1155 {
    constructor(string memory name) ERC1155(name) {}

    function mint(address to, uint256 id) public {
        _mint(to, id, 1, "");
    }
}
