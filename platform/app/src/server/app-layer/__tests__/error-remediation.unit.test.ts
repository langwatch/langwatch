import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { REMEDIATION_CODES, REMEDIATION_DOC_PATHS } from "../error-remediation";

// platform/app/src/server/app-layer/__tests__ → repo root → docs/
const DOCS_ROOT = path.resolve(__dirname, "../../../../../docs");

describe("error remediation registry", () => {
  it.each(REMEDIATION_DOC_PATHS)("docs page exists: %s", (docsPath) => {
    expect(
      existsSync(path.join(DOCS_ROOT, `${docsPath.slice(1)}.mdx`)),
      `${docsPath} must map to a real file under docs/`,
    ).toBe(true);
  });

  it("has no duplicate codes", () => {
    expect(new Set(REMEDIATION_CODES).size).toBe(REMEDIATION_CODES.length);
  });

  it("every entry carries at least one remediation channel", async () => {
    const { remediation } = await import("../error-remediation");
    for (const code of REMEDIATION_CODES) {
      const r = remediation(code);
      expect(
        (r.tips?.length ?? 0) > 0 || r.docsUrl !== undefined,
        `${code} must define tips or a docs link`,
      ).toBe(true);
    }
  });
});
