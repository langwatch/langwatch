import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
    test: {
        testTimeout: 15_000,
        hookTimeout: 15_000,
        setupFiles: ["dotenv/config"],
        environment: "node",
        include: [
            "src/**/*.test.ts",
            "!src/**/*.e2e.test.ts",
        ],
        exclude: [
            "examples/**",
        ],
    },
    resolve: {
        alias: {
            "@": resolve(__dirname, "./src"),
            "@/cli": resolve(__dirname, "./src/cli"),
            "@/client-sdk": resolve(__dirname, "./src/client-sdk"),
            "@/observability-sdk": resolve(
                __dirname,
                "./src/observability-sdk",
            ),
            "@/internal": resolve(__dirname, "./src/internal"),
        },
    },
});
