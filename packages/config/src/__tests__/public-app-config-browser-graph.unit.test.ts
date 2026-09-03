import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The browser-safe contract must not reach the deployment projection.
 *
 * `public-app-config.projection.ts` declares the deployment's whole runtime
 * configuration at module scope, and that declaration names secret variables:
 * `SENDGRID_API_KEY`, `RESEND_API_KEY`, `SMTP_URL`. The values never reach a
 * browser — there is no `process.env` there — but the names and the config
 * runtime do, because this package does not mark itself side-effect free, so a
 * module-scope `RuntimeConfig.define` cannot be shaken out.
 *
 * `usePublicEnv` reaches `./public-app-config` through the application's
 * reader, so anything that module reaches is in the client bundle. This matches
 * import and export STATEMENTS rather than the bare path, because both modules'
 * docblocks name the projection to explain why they do not import it — a
 * substring check would fail on the explanation and pass once someone deleted
 * it.
 */
const MODULE_EDGE =
  /^\s*(?:import|export)\b[^;]*?["'][^"']*public-(?:app-)?config\.projection["']/m;
const here = dirname(fileURLToPath(import.meta.url));
const readSource = (relative: string) => readFileSync(resolve(here, "..", relative), "utf8");

/**
 * The application's reader, which is the browser entry point to all of this.
 * Read across the workspace on purpose: the contract moved here and the reader
 * did not, so the edge that has to stay absent now spans two packages and a
 * guard that only looked at one of them would pass over the half it cannot see.
 */
const readApplicationReader = () =>
  readFileSync(
    resolve(here, "..", "..", "..", "..", "apps", "ui", "src", "behavior", "public-config.ts"),
    "utf8",
  );

describe("given the browser's public-config reader", () => {
  describe("when it is imported by client code", () => {
    it("reaches no module that declares the deployment's secrets", () => {
      expect(readSource("public-app-config.ts")).not.toMatch(MODULE_EDGE);
      expect(readApplicationReader()).not.toMatch(MODULE_EDGE);
    });

    it("keeps the projection reachable on its own subpath", () => {
      const source = readSource("public-app-config.projection.ts");
      expect(source).toContain("SENDGRID_API_KEY");
    });
  });
});
