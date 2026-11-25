import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { WorkflowCodeCompletionService } from "../workflow-code-completion.service.ts";

describe("WorkflowCodeCompletionService.complete", () => {
  it("validates the completion definition before asking for a completion", async () => {
    const generateText = vi.fn<ModelProviderApi["generateText"]>();
    const service = WorkflowCodeCompletionService.create({
      modelProviders: createApiFixture<ModelProviderApi>({ generateText }),
    });

    await expect(
      service.complete({ projectId: "project_1", body: { unrelated: true } }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(generateText).not.toHaveBeenCalled();
  });
});
