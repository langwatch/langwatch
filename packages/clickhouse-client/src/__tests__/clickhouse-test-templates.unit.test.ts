/**
 * Spec: specs/ci/package-suite-integration-lane.feature
 */
import { describe, expect, it } from "vitest";

import { redirectDatabase } from "../clickhouse-test-templates.ts";

describe("redirectDatabase", () => {
  describe("given a view that names the template in a string literal", () => {
    /** @scenario "A copied statement keeps its string literals" */
    it("points the qualifiers at the copy and leaves the literal as written", () => {
      expect(
        redirectDatabase({
          statement:
            "CREATE VIEW template.label AS SELECT 'template.events' AS label, 'it''s template.x' FROM template.events",
          from: "template",
          to: "copy",
        }),
      ).toBe(
        "CREATE VIEW copy.label AS SELECT 'template.events' AS label, 'it''s template.x' FROM copy.events",
      );
    });
  });

  describe("given a backquoted qualifier and a longer database name sharing the prefix", () => {
    it("redirects the qualifier and leaves the other database alone", () => {
      expect(
        redirectDatabase({
          statement:
            "CREATE MATERIALIZED VIEW `template`.mv TO template.t AS SELECT * FROM other_template.s",
          from: "template",
          to: "copy",
        }),
      ).toBe("CREATE MATERIALIZED VIEW copy.mv TO copy.t AS SELECT * FROM other_template.s");
    });
  });
});
