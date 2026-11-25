/**
 * Whether a statement reads the sources placeholder, as the server decides it.
 * @see modules/dashboard/specs/dashboards-v2.feature AC204c
 */

import { describe, expect, it } from "vitest";

import { readsSourcesParameter } from "../analytics.lwql-time-window.ts";

const reading = (placeholder: string) =>
  `SELECT count() FROM trace_metrics WHERE Source IN ${placeholder}`;

describe("readsSourcesParameter", () => {
  /** @scenario "AC204c Sources: a placeholder only in a comment or a literal does not count as reading the parameter" */
  it("reads the placeholder with any spacing inside its type, as the server accepts it", () => {
    expect(readsSourcesParameter(reading("{dashboard_context_sources:Array(String)}"))).toBe(true);
    expect(readsSourcesParameter(reading("{dashboard_context_sources:Array( String )}"))).toBe(
      true,
    );
    expect(readsSourcesParameter(reading("{dashboard_context_sources: Array(String) }"))).toBe(
      true,
    );
  });

  /** @scenario "AC204c Sources: a placeholder only in a comment or a literal does not count as reading the parameter" */
  it("does not count a placeholder in a comment, a literal or of another type", () => {
    expect(readsSourcesParameter("SELECT 1 -- {dashboard_context_sources:Array(String)}")).toBe(
      false,
    );
    expect(readsSourcesParameter("SELECT '{dashboard_context_sources:Array(String)}'")).toBe(false);
    expect(
      readsSourcesParameter(reading("{dashboard_context_sources:Array(Nullable(String))}")),
    ).toBe(false);
  });
});
