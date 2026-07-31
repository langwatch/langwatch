import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // The app's tsconfig maps `~/*` to `src/*`; the adapter under test pulls
    // schema types through that alias, so mirror it here.
    alias: { "~": path.resolve(__dirname, "../../src") },
  },
  test: {
    testTimeout: 300_000, // scenario runs include an LLM judge + user simulator
    hookTimeout: 30_000,
  },
});
