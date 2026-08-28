import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The browser reader must not reach the deployment projection.
 *
 * `public-config.projection.ts` declares the deployment's whole runtime
 * configuration at module scope, and that declaration names secret variables:
 * `SENDGRID_API_KEY`, `RESEND_API_KEY`, `SMTP_URL`. The values never reach a
 * browser — there is no `process.env` there — but the names and the config
 * runtime do, because neither this package nor `@langwatch/config` marks itself
 * side-effect free, so a module-scope `RuntimeConfig.define` cannot be shaken
 * out.
 *
 * `usePublicEnv` imports `@langwatch/ui/public-config`, so anything that module
 * reaches is in the client bundle. This matches import and export STATEMENTS
 * rather than the bare path, because the reader's own docblock names the
 * projection to explain why it does not import it — a substring check would
 * fail on the explanation and pass once someone deleted it.
 */
const MODULE_EDGE =
  /^\s*(?:import|export)\b[^;]*?["'][^"']*public-config\.projection["']/m;
const here = dirname(fileURLToPath(import.meta.url));
const readSource = (relative: string) =>
  readFileSync(resolve(here, "..", "src", relative), "utf8");

describe("given the browser's public-config reader", () => {
  describe("when it is imported by client code", () => {
    it("reaches no module that declares the deployment's secrets", () => {
      expect(readSource("behavior/public-config.ts")).not.toMatch(MODULE_EDGE);
    });

    it("keeps the projection reachable on its own subpath", () => {
      const source = readSource("behavior/public-config.projection.ts");
      expect(source).toContain("SENDGRID_API_KEY");
    });
  });
});
