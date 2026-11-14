/**
 * An update that carries `tags` moves a deployment tag, so it asks `prompts:manage` as the tag
 * route does; an update without `tags` asks only `prompts:update`.
 * Spec: modules/prompt/specs/prompt.feature
 */
import type { ApiResponsePrompt } from "@langwatch/prompt-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { PromptService } from "../../services/prompt.service.ts";
import {
  buildPromptApp,
  mountPromptRest,
  PROMPT_TEST_ORGANIZATION,
  PROMPT_TEST_PROJECT,
} from "./prompt-rest.harness.ts";

const NOW = new Date("2026-11-13T00:00:00.000Z");

const UPDATED: ApiResponsePrompt = {
  id: "prompt_1",
  name: "Checkout agent",
  handle: "checkout-agent",
  scope: "PROJECT",
  version: 2,
  versionId: "prompt_version_2",
  model: "openai/gpt-5-mini",
  prompt: "Be brief.",
  projectId: PROMPT_TEST_PROJECT,
  organizationId: PROMPT_TEST_ORGANIZATION,
  messages: [],
  authorId: null,
  inputs: [],
  outputs: [{ identifier: "output", type: "str" }],
  updatedAt: NOW,
  createdAt: NOW,
  tags: [],
  parameters: {},
};

function updateWith({
  body,
  withheld,
}: {
  body: Record<string, unknown>;
  withheld?: readonly string[];
}) {
  const app = buildPromptApp(createApiFixture<PromptService>());
  const updateWithTags = vi.spyOn(app, "updateWithTags").mockResolvedValue(UPDATED);
  const response = mountPromptRest({ app, ...(withheld ? { withheld } : {}) }).request(
    "/api/prompts/checkout-agent",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commitMessage: "tighten", prompt: "Be brief.", ...body }),
    },
  );

  return { response, updateWithTags };
}

describe("PUT /api/prompts/:id", () => {
  describe("given a key that holds prompts:update but not prompts:manage", () => {
    /** @scenario An update that moves a tag needs the permission to manage prompts */
    it("refuses an update carrying tags before it saves anything", async () => {
      const { response, updateWithTags } = updateWith({
        body: { tags: ["production"] },
        withheld: ["prompts:manage"],
      });

      const answered = await response;
      const body = (await answered.json()) as { code: string };

      expect(answered.status).toBe(403);
      expect(body.code).toBe("permission_denied");
      expect(updateWithTags).not.toHaveBeenCalled();
    });

    /** @scenario An update that moves a tag needs the permission to manage prompts */
    it("saves an update without tags", async () => {
      const { response, updateWithTags } = updateWith({
        body: {},
        withheld: ["prompts:manage"],
      });

      expect((await response).status).toBe(200);
      expect(updateWithTags).toHaveBeenCalledOnce();
    });
  });

  describe("given a key that holds prompts:manage", () => {
    /** @scenario An update that moves a tag needs the permission to manage prompts */
    it("saves the update and passes the tags on", async () => {
      const { response, updateWithTags } = updateWith({ body: { tags: ["production"] } });

      expect((await response).status).toBe(200);
      expect(updateWithTags).toHaveBeenCalledWith(
        expect.objectContaining({ tags: ["production"] }),
      );
    });
  });
});
