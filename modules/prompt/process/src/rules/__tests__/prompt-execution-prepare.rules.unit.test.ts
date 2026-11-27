import { WorkflowModelProviderUnavailableError } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { isEditorFixablePrepareError } from "../prompt-execution-prepare.rules.ts";

describe("isEditorFixablePrepareError", () => {
  it("treats a disabled model provider as the person's to fix", () => {
    const error = new WorkflowModelProviderUnavailableError({ provider: "openai", disabled: true });

    expect(isEditorFixablePrepareError(error)).toBe(true);
  });

  it("leaves an unexpected failure as a server fault", () => {
    expect(isEditorFixablePrepareError(new Error("socket hang up"))).toBe(false);
  });
});
