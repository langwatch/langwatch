import { defineConfig } from "vitest/config";

process.env.OPENAI_API_KEY = "bogus";

export default defineConfig({
    test: {
        testTimeout: 30_000,
        hookTimeout: 30_000,
        setupFiles: ["dotenv/config"],
    },
});
