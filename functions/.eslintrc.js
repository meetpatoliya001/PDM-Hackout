module.exports = {
  env: {
    node: true,   // Enables Node.js global variables like require, module, exports
    es2021: true, // Supports modern JS syntax
  },
  extends: [
    "eslint:recommended"
  ],
  parserOptions: {
    ecmaVersion: 12,
  },
  rules: {},
};