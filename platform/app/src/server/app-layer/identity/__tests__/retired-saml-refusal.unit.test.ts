/** @vitest-environment node */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The refusal SAML self-serve retired, kept retired.
 *
 * `sso_saml_not_self_serve` turned a SAML registration away for being SAML,
 * whatever it carried. Registration validates what it was given now, and
 * refuses only what it cannot read — the behaviour half of that is pinned in
 * packages/identity-server. This is the other half of the same scenario: the
 * spec says no surface in the product raises it ANY MORE, which is a claim
 * about the whole tree rather than about one call, and the way it comes back
 * is somebody reaching for a familiar-looking code in a year's time.
 *
 * Spec: specs/identity/sso-idp-termination.feature
 */

const REPO_ROOT = join(import.meta.dirname, "../../../../../../..");
const RETIRED_CODE = "sso_saml_not_self_serve";

const PRODUCT_ROOTS = [
  join(REPO_ROOT, "platform/app/src"),
  join(REPO_ROOT, "platform/app/ee"),
  join(REPO_ROOT, "packages/identity"),
  join(REPO_ROOT, "packages/identity-server"),
  join(REPO_ROOT, "packages/handled-error"),
];

describe("given the refusal SAML self-serve retired", () => {
  describe("when the product is read for it", () => {
    /** @scenario "SAML is no longer refused for being SAML" */
    it("finds it named nowhere a customer could meet it", () => {
      const offenders: string[] = [];

      for (const root of PRODUCT_ROOTS) {
        for (const entry of readdirSync(root, { recursive: true })) {
          const file = String(entry);
          if (!/\.tsx?$/.test(file)) continue;
          if (file.includes("__tests__")) continue;
          if (file.includes("node_modules")) continue;
          // The generated client names every column of every table; it is not
          // a surface anybody raises anything from.
          if (file.startsWith("generated/")) continue;
          if (readFileSync(join(root, file), "utf8").includes(RETIRED_CODE)) {
            offenders.push(join(root, file).slice(REPO_ROOT.length + 1));
          }
        }
      }

      expect(offenders).toEqual([]);
    });
  });
});
