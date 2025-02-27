/** @type {import("eslint").Linter.Config} */
const config = {
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: true,
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "next/core-web-vitals",
    "plugin:@typescript-eslint/recommended-type-checked",
    "plugin:@typescript-eslint/stylistic-type-checked",
  ],
  rules: {
    // These opinionated rules are enabled in stylistic-type-checked above.
    // Feel free to reconfigure them to your own preference.
    "@typescript-eslint/array-type": "off",
    "@typescript-eslint/consistent-type-definitions": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unsafe-assignment": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/require-await": "off",
    "@typescript-eslint/no-unsafe-member-access": "off",
    "@typescript-eslint/no-unsafe-call": "off",
    "@typescript-eslint/no-unsafe-argument": "off",
    "@typescript-eslint/no-unsafe-return": "off",

    "@typescript-eslint/consistent-type-imports": [
      "warn",
      {
        prefer: "type-imports",
        fixStyle: "inline-type-imports",
      },
    ],
    "@typescript-eslint/no-unused-vars": [
      "warn",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      },
    ],
    // Also, Checkbox, CheckboxGroup (from ui/checkbox), Drawer, Radio, RadioGroup (from ui/radio), InputGroup (from ui/input-group), Switch, Popover, Link, Menu, Dialog, InputGroup and Tooltip should always be imported from components/ui, not from chakra directly, and it should always be a relative import, we don't use @ aliases.

    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "@chakra-ui/react",
            importNames: [
              "Checkbox",
              "CheckboxGroup",
              "Drawer",
              "Radio",
              "RadioGroup",
              "InputGroup",
              "Switch",
              "Popover",
              "Link",
              "Menu",
              "Dialog",
              "InputGroup",
              "Tooltip",
            ],
            message:
              "Component must be imported from 'components/ui' instead of '@chakra-ui/react'.",
          },
        ],
      },
    ],
  },
};

module.exports = config;
