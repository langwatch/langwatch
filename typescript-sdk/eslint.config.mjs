import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

/** @type {import('typescript-eslint').Config} */
const config = tseslint.config(
    {
        ignores: [
            "dist/**",
            "coverage/**",
            "examples/**",
            "**/generated/**",
            // Dev-only helpers, ignored BY NAME rather than by a
            // `scripts/**/*.mjs` glob. That glob also silenced
            // scripts/generate-skills-bundle.mjs, which is build-critical:
            // copy-types.sh runs it on every install and build, and its output
            // is compiled into the published tarball and all five release
            // binaries. It is linted (untyped) by the block below instead.
            "scripts/profile-startup.mjs",
            "scripts/startup-require-hook.cjs",
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
        // Plain-node build scripts (scripts/generate-skills-bundle.mjs). They
        // are outside tsconfig.eslint.json, so type-aware rules cannot run —
        // but the untyped ones (no-undef, no-unused-vars, no-fallthrough) can,
        // and those are the ones that catch a broken codegen script before it
        // ships generated code into the tarball.
        files: ["scripts/**/*.mjs"],
        ...tseslint.configs.disableTypeChecked,
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            parserOptions: { project: false, projectService: false },
            globals: { console: "readonly", process: "readonly" },
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
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    destructuredArrayIgnorePattern: "^_",
                    ignoreRestSiblings: true,
                },
            ],
        },
    },
);

export default config;
