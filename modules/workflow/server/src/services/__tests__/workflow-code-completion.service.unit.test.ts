import { describe, expect, it, vi } from "vitest";

import { WorkflowCodeCompletionService } from "../workflow-code-completion.service.ts";

describe("WorkflowCodeCompletionService.complete", () => {
  it("validates the completion definition before resolving a model", async () => {
    const resolveModel = vi.fn();
    const service = WorkflowCodeCompletionService.create({ resolveModel });

    await expect(
      service.complete({ projectId: "project_1", body: { unrelated: true } }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(resolveModel).not.toHaveBeenCalled();
  });
});
