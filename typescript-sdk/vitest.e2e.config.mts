import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
    test: {
        testTimeout: 30_000,
        hookTimeout: 30_000,
        setupFiles: [
            "dotenv/config",
            "./__tests__/e2e/setup/global-setup.ts",
            "./__tests__/e2e/setup/msw-setup.ts",
        ],
        include: ["**/*.e2e.test.ts"],
        passWithNoTests: true,
        env: {
            LANGWATCH_API_KEY: process.env.LANGWATCH_API_KEY,
            LANGWATCH_ENDPOINT:
                process.env.LANGWATCH_ENDPOINT ?? "http://localhost:5560",
        },
    },
    resolve: {
        alias: {
            "@": resolve(__dirname, "./src"),
        },
    },
});
