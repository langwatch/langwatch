/**
 * Finding H7 of the 2026-09-04 feature-surface security pass: the prompt lookup this route
 * makes deliberately also matches ORGANIZATION-scoped prompts a sibling project owns, so
 * Spec: specs/security/resource-scope-permission-checks.feature
 */
import type { PromptApi } from "@langwatch/prompt-contract";
import { describe, expect, it, vi } from "vitest";

import {
  mountPromptRest,
  PROMPT_TEST_ORGANIZATION,
  PROMPT_TEST_PROJECT,
} from "./prompt-rest.harness.ts";

const OWNING_PROJECT = "project_owner";

function buildApi() {
  const assignTag = vi.fn(async (input: { tag: string; versionId: string }) => ({
    configId: "prompt_1",
    versionId: input.versionId,
    promptTag: { name: input.tag },
    updatedAt: new Date("2026-09-04T00:00:00.000Z"),
  }));

  const app = {
    // The organization-scoped prompt a SIBLING project owns, which is what the
    // by-handle lookup is written to reach.
    tryGetPromptByIdOrHandle: vi.fn(async () => ({ id: "prompt_1", projectId: OWNING_PROJECT })),
    assignTag,
  } as unknown as PromptApi;

  const family = mountPromptRest({ app });

  return {
    assignTag,
    assign: (handle: string, versionId: string) =>
      family.request(`/api/prompts/${handle}/tags/production`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId }),
      }),
  };
}

describe("PUT /api/prompts/:id/tags/:tag", () => {
  describe("given an organization-scoped prompt a sibling project owns", () => {
    /** @scenario Assigning a tag writes into the project the caller was authorized on */
    it("writes the assignment for the authorized project, not the prompt's owner", async () => {
      const { assign, assignTag } = buildApi();

      const response = await assign("checkout-agent", "prompt_version_old");

      expect(response.status).toBe(200);
      expect(assignTag).toHaveBeenCalledWith({
        configId: "prompt_1",
        versionId: "prompt_version_old",
        tag: "production",
        projectId: PROMPT_TEST_PROJECT,
        organizationId: PROMPT_TEST_ORGANIZATION,
      });
    });
  });
});
