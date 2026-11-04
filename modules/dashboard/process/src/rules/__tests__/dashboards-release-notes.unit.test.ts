/**
 * The docs say a rollback is unsupported for widget sources and projects, and what it would show.
 * @see modules/dashboard/specs/dashboards-v2.feature AC210d
 * @see specs/lwql/query-params.feature QP23
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const docs = readFileSync(
  fileURLToPath(new URL("../../../../../../docs/features/dashboards.mdx", import.meta.url)),
  "utf8",
).replace(/\s+/g, " ");

describe("given the dashboards docs", () => {
  /** @scenario "AC210d Rollback: a rollback is not supported for this feature" */
  it("says a rollback shows multi-project widgets for the board's project only", () => {
    expect(docs).toContain(
      "Rolling back to a release before this one shows multi-project widgets for the board's project only. A rollback is not supported for this feature.",
    );
  });

  /** @scenario "QP23 A rollback is not supported for this feature" */
  it("says it once, as the release note", () => {
    expect(docs.match(/A rollback is not supported for this feature/g)).toHaveLength(1);
  });
});
