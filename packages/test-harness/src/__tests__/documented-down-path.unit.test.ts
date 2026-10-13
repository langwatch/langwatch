/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { documentedDownPath } from "../cleanup-test-rows.ts";

describe("documentedDownPath", () => {
  it("reads the statement under the migration's down heading", () => {
    expect(documentedDownPath({ migration: "20261006120001_grant_condition" })).toBe(
      'ALTER TABLE "Grant" DROP COLUMN "condition";',
    );
  });

  it("throws when the migration documents no down path", () => {
    expect(() => documentedDownPath({ migration: "20260818120001_grant_resource_facts" })).toThrow(
      /no longer documents its down path/,
    );
  });
});
