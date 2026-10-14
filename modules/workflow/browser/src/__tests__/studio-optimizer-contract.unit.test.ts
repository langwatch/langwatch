import { studioOptimizerParamsSchema } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { optimizerParamsSchema } from "../model/optimizers.ts";

describe("the browser's optimizer parameter schema", () => {
  /** @scenario "Studio execution events use one portable wire contract" */
  it("is the Workflow contract's, not a copy", () => {
    expect(optimizerParamsSchema).toBe(studioOptimizerParamsSchema);
  });
});
