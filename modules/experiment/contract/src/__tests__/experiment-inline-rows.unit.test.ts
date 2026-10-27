import { resolveRequestBound } from "@langwatch/plans";
/**
 * The registry enterprise ceiling is the outer validation shell for inline
 * row data: above 4000 rows refuses at the schema. The execution data load
 * refuses above the caller's tier, so the bound holds at every entry.
 */
import { describe, expect, it } from "vitest";

import { executionRequestSchema, runInputsBodySchema } from "../workbench/execution/types.ts";

const ENTERPRISE_ROWS = resolveRequestBound("experimentInlineRowsMax", "ENTERPRISE");

const rows = (count: number) => Array.from({ length: count }, (_, index) => ({ row: index }));

const baseRequest = {
  projectId: "p1",
  name: "Run",
  dataset: { id: "d1", name: "Inline", type: "inline", columns: [] },
  targets: [],
  evaluators: [],
  scope: { type: "full" },
};

describe("execution request inline data bound", () => {
  it("executionRequestSchema refuses data above the enterprise ceiling", () => {
    expect(
      executionRequestSchema.validate({ ...baseRequest, data: rows(ENTERPRISE_ROWS + 1) }),
    ).toBe(false);
    expect(executionRequestSchema.validate({ ...baseRequest, data: rows(ENTERPRISE_ROWS) })).toBe(
      true,
    );
  });

  it("runInputsBodySchema refuses data above the enterprise ceiling", () => {
    expect(runInputsBodySchema.validate({ data: rows(ENTERPRISE_ROWS + 1) })).toBe(false);
    expect(runInputsBodySchema.validate({ data: rows(ENTERPRISE_ROWS) })).toBe(true);
  });
});
