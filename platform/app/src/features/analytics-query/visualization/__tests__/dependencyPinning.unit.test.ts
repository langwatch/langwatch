/**
 * The Vega dependency set.
 *
 * A range would let a resolver pick a different Vega on the next install than
 * the one the chart policy and the CSP evidence were established against, so
 * the four packages are exact-pinned and the compatibility between them is
 * asserted here rather than remembered from the PR body.
 *
 * Node environment on purpose — see `validateVegaLiteSpec.unit.test.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/** `…/visualization/__tests__` → `platform/app/` */
const APP_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

/** The set the chart layer needs, and the version each was reviewed at. */
const PINNED_VEGA_PACKAGES = {
  "react-vega": "8.0.0",
  vega: "6.3.1",
  "vega-lite": "6.4.3",
  "vega-embed": "7.1.0",
} as const;

const readManifest = (path: string) =>
  JSON.parse(readFileSync(path, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    version?: string;
  };

describe("the Vega dependency set", () => {
  describe("given the application's dependency manifest", () => {
    describe("when the Vega packages are inspected", () => {
      /** @scenario "The Vega dependency set is pinned and compatible" */
      it("declares all four as direct, exact-pinned, mutually compatible versions", () => {
        const manifest = readManifest(join(APP_ROOT, "package.json"));
        const dependencies = manifest.dependencies ?? {};

        for (const [name, version] of Object.entries(PINNED_VEGA_PACKAGES)) {
          expect(
            dependencies[name],
            `${name} must be a direct dependency`,
          ).toBe(version);
          expect(
            /^[~^><=*]|\s|x/.test(version),
            `${name} must be exact-pinned`,
          ).toBe(false);
          expect(
            manifest.devDependencies?.[name],
            `${name} belongs in dependencies`,
          ).toBeUndefined();
        }

        // React is the peer react-vega@8 declares; a major bump on either side
        // has to be reconciled deliberately rather than resolved silently.
        expect(dependencies.react).toBeDefined();
        expect(dependencies.react?.startsWith("^19")).toBe(true);
      });

      it("agrees with what the installed packages say they need", () => {
        const installed = (name: string) =>
          readManifest(join(APP_ROOT, "node_modules", name, "package.json"));

        // vega-lite@6 peers on vega@^6, react-vega@8 peers on vega-embed@^7 and
        // React 17-19, and vega-embed accepts any vega / vega-lite.
        expect(installed("vega-lite").peerDependencies?.vega).toBe("^6.0.0");
        expect(installed("vega").version).toMatch(/^6\./);
        expect(installed("react-vega").peerDependencies?.["vega-embed"]).toBe(
          "^7",
        );
        expect(installed("react-vega").peerDependencies?.react).toContain(
          "^19",
        );
        expect(installed("vega-embed").version).toMatch(/^7\./);
      });
    });
  });
});
