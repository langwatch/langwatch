// Runs only the OWASP pack, which a plain vitest run skips:
// npx vitest run --config tests/owasp/owasp.vitest.config.ts
import { fileURLToPath } from "url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["owasp-pack.redteam.ts"],
  },
});
