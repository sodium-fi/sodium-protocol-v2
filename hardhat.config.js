require("@nomicfoundation/hardhat-chai-matchers");
require("hardhat-contract-sizer");
require("@openzeppelin/hardhat-upgrades");
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();
require("hardhat-deploy");
require("@nomiclabs/hardhat-etherscan");
require("hardhat-deploy-ethers");
require("hardhat-gas-reporter");

module.exports = {

    solidity: {
        version: "0.8.16",
        settings: {
            optimizer: {
                enabled: true,
                runs: 35500,
            },
            outputSelection: {
                "*": {
                    "*": ["storageLayout"],
                },
            },
        },
    },

    gasReporter: {
        currency: 'USD',
        enabled: true,
        gasPrice: 21,
        coinmarketcap: process.env.COINMARKETCAP_KEY,
        noColors: true
    },

    etherscan: {
        apiKey: process.env.ETHERSCAN_KEY,
    },

    namedAccounts: {
        deployer: {
            default: 0
        },
        owner: {
            default: 1
        },
        otherAccount: {
            default: 2
        },
        bob: {
            default: 3
        },
        alice: {
            default: 4
        },
        lucy: {
            default: 5
        },
        validator: {
            default: 6
        },
        treasury: {
            default: 7
        },
        poolOwner: {
            default: 8
        },
        oracle: {
            default: 9
        },
    },

    networks: {},
};