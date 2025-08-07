import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        testTimeout: 30_000,
        hookTimeout: 30_000,
        setupFiles: ["dotenv/config", "./__tests__/e2e/setup/msw-setup.ts"],
        include: ["__tests__/e2e/**/*.e2e-test.ts"],
    },
});
