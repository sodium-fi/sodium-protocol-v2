module.exports = {
    env: {
        es6: true,
        node: true,
    },
    extends: [
        "standard",
        "eslint:recommended",
        "plugin:node/recommended",
        "plugin:mocha/recommended",
        // "prettier"
    ],
    globals: {
        Atomics: "readonly",
        SharedArrayBuffer: "readonly",
    },
    parserOptions: {
        ecmaVersion: 2018,
        sourceType: "module",
    },
    rules: {
        "no-tabs": 0,
        indent: ["error", "tab"],
        "linebreak-style": ["error", "unix"],
        quotes: ["error", "double"],
        semi: ["error", "always"],
        "node/no-extraneous-require": [
            "error",
            {
                allowModules: [
                    "@nomicfoundation/hardhat-network-helpers",
                    "@nomicfoundation/hardhat-chai-matchers",
                    "chai",
                ],
            },
        ],
        "node/no-unpublished-require": "off",
        "node/no-unsupported-features/es-syntax": "off",
        "mocha/no-setup-in-describe": "off",
    },
    plugins: ["prettier"],
};
