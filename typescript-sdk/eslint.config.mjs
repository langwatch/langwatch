import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

/** @type {import('typescript-eslint').Config} */
const config = tseslint.config(
    {
        ignores: [
            "dist/**",
            "coverage/**",
            "examples/**",
            "ts-to-zod.config.js",
            "**/generated/**",
        ],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                project: "./tsconfig.eslint.json",
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
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
                { argsIgnorePattern: "^_" },
            ],
        },
    },
);

export default config;
