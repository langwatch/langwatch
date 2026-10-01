/**
 * Finding H7 of the 2026-09-04 feature-surface security pass: the prompt lookup this route
 * makes deliberately also matches ORGANIZATION-scoped prompts a sibling project owns, so
 * Spec: specs/security/resource-scope-permission-checks.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { VersionedPrompt } from "@langwatch/prompt-contract";
import { describe, expect, it, vi } from "vitest";

import type { PromptService } from "../../services/prompt.service.ts";
import {
  buildPromptApp,
  mountPromptRest,
  PROMPT_TEST_ORGANIZATION,
  PROMPT_TEST_PROJECT,
} from "./prompt-rest.harness.ts";

const OWNING_PROJECT = "project_owner";

const NOW = new Date("2026-09-04T00:00:00.000Z");

const SIBLING_PROMPT: VersionedPrompt = {
  id: "prompt_1",
  name: "Checkout agent",
  handle: "checkout-agent",
  scope: "ORGANIZATION",
  version: 1,
  versionId: "prompt_version_old",
  versionCreatedAt: NOW,
  model: "openai/gpt-5-mini",
  prompt: "Be brief.",
  projectId: OWNING_PROJECT,
  organizationId: PROMPT_TEST_ORGANIZATION,
  messages: [],
  authorId: null,
  inputs: [],
  outputs: [],
  updatedAt: NOW,
  createdAt: NOW,
  tags: [],
  parameters: {},
};

function buildApi() {
  const assignTag = vi.fn<PromptService["assignTag"]>(async (input) => ({
    configId: "prompt_1",
    versionId: input.versionId,
    promptTag: {
      id: "tag_1",
      organizationId: PROMPT_TEST_ORGANIZATION,
      name: input.tag,
      createdAt: NOW,
    },
    updatedAt: NOW,
  }));

  const app = buildPromptApp(
    createApiFixture<PromptService>({
      // The organization-scoped prompt a SIBLING project owns, which is what the
      // by-handle lookup is written to reach.
      getPromptByIdOrHandle: async () => SIBLING_PROMPT,
      assignTag,
    }),
  );

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
