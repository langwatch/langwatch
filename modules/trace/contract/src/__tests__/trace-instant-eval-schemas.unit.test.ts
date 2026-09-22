/**
 * What the Explorer may ask an Instant Eval for.
 * Spec: specs/traces-v2/instant-eval-search.feature
 */
import { describe, expect, it } from "vitest";

import { explorerInstantEvalRunSchema } from "../trace-instant-eval.schemas.ts";

const request = {
  projectId: "project-1",
  target: "traces",
  window: { from: 1_700_000_000_000, to: 1_700_003_600_000 },
  question: { instructions: "is the user annoyed" },
};

describe("explorerInstantEvalRunSchema", () => {
  it("defaults the filter to judging everything in the window", () => {
    expect(explorerInstantEvalRunSchema.parse(request).filter).toBe("");
  });

  /** @scenario "A window outside the calendar range is refused as a validation error" */
  it("refuses a window bound past what a date can represent", () => {
    const parsed = explorerInstantEvalRunSchema.safeParse({
      ...request,
      window: { from: 8_640_000_000_000_001, to: 1_700_003_600_000 },
    });

    expect(parsed.success).toBe(false);
  });
});
