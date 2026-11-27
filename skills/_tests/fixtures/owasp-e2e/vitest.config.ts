// Runs the TypeScript pack as shipped, on the real scenario SDK, with a stub model
// and a refusing agent. OWASP_E2E_CONFIG=example swaps in the filled example config.
import path from "path";
import { fileURLToPath } from "url";

import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const pack = path.resolve(here, "../../../recipes/owasp-red-team/templates/typescript");
const example = process.env.OWASP_E2E_CONFIG === "example";

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@ai-sdk\/openai$/, replacement: path.join(here, "stub-openai.ts") },
      { find: /^\.\/agent-adapter$/, replacement: path.join(here, "agent-adapter.ts") },
      ...(example
        ? [{ find: /^\.\/owasp\.config$/, replacement: path.join(here, "owasp.config.ts") }]
        : []),
    ],
  },
  test: { root: pack, include: ["owasp-pack.redteam.ts"] },
});
