import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  REMEDIATION_CODES,
  REMEDIATION_DOC_PATHS,
  remediation,
} from "../remediation";

// packages/handled-error/src/__tests__ → repo root → docs/
const DOCS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../docs");

describe("error remediation registry", () => {
  it.each(REMEDIATION_DOC_PATHS)("docs page exists: %s", (docsPath) => {
    expect(
      existsSync(path.join(DOCS_ROOT, `${docsPath.slice(1)}.mdx`)),
      `${docsPath} must map to a real file under docs/`,
    ).toBe(true);
  });

  describe("when the dataset storage root is not writable", () => {
    /** @scenario The remediation names the two ways an operator fixes it */
    it("names the object storage bucket and the local storage path", () => {
      const tips = remediation("storage_not_writable").tips ?? [];

      expect(tips.some((tip) => tip.includes("S3_BUCKET_NAME"))).toBe(true);
      expect(
        tips.some((tip) => tip.includes("LANGWATCH_LOCAL_STORAGE_PATH")),
      ).toBe(true);
    });
  });

  describe("when no model is configured for a feature", () => {
    it("names the Default Models page, the organization scope, and the documentation", () => {
      const { tips = [], docsUrl } = remediation("model_not_configured");

      expect(tips.some((tip) => tip.includes("Default Models"))).toBe(true);
      expect(tips.some((tip) => tip.includes("organization scope"))).toBe(true);
      expect(docsUrl).toContain("/platform/model-providers");
    });
  });

  it("has no duplicate codes", () => {
    expect(new Set(REMEDIATION_CODES).size).toBe(REMEDIATION_CODES.length);
  });

  it("every entry carries at least one remediation channel", () => {
    for (const code of REMEDIATION_CODES) {
      const r = remediation(code);
      expect(
        (r.tips?.length ?? 0) > 0 || r.docsUrl !== undefined,
        `${code} must define tips or a docs link`,
      ).toBe(true);
    }
  });
});
