// SPDX-License-Identifier: MIT
pragma solidity ^0.8.16;

import "@openzeppelin/contracts/proxy/Clones.sol";

import "./interfaces/ISodiumWalletFactory.sol";
import "./interfaces/ISodiumWallet.sol";

/// @notice Simple clone factory for creating minimal proxy Sodium Wallets
contract SodiumWalletFactory is ISodiumWalletFactory {
    address public implementation;
    address public registry;

    /// @param implementation_ The contract to which wallets deployed by this contract delegate their calls
    /// @param registry_ Used by the wallets to determine external call permission
    constructor(address implementation_, address registry_) {
        implementation = implementation_;
        registry = registry_;
    }

    /// @notice Called by the Core to create new wallets
    /// @dev Deploys a minimal EIP-1167 proxy that delegates its calls to `implementation`
    /// @param requester The owner of the new wallet
    function createWallet(address requester) external override returns (address) {
        address wallet = Clones.clone(implementation);
        ISodiumWallet(wallet).initialize(requester, msg.sender, registry);
        emit WalletCreated(requester, wallet);

        return wallet;
    }
}
