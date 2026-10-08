/**
 * Instant Evals answers evaluator judges only, so a prompt save naming it is refused before
 * anything is stored. Every prompt write (REST, tRPC, sync, library) lands in these two methods.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 * @vitest-environment node
 */
import {
  INSTANT_EVAL_JUDGE_MODEL_ID,
  InstantEvalJudgeOnlyModelError,
} from "@langwatch/instant-eval-judge-contract";
import { parseLlmConfigVersion } from "@langwatch/prompt-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { LlmConfigRepository } from "../../repositories/prompt.repository.ts";
import type { PromptReadService } from "../prompt-read.service.ts";
import type { PromptTagLookupService } from "../prompt-tag-lookup.service.ts";
import { PromptVersionService } from "../prompt-version.service.ts";
import { PromptWriteService } from "../prompt-write.service.ts";

function promptWrites() {
  const stored: unknown[] = [];
  const saved = { latestVersion: { id: "version-1" } };
  const writes = PromptWriteService.create({
    repository: createApiFixture<LlmConfigRepository>({
      createConfigWithInitialVersion: async (input) => {
        stored.push(input);
        return saved as never;
      },
      updateConfigAndCreateVersion: async (input) => {
        stored.push(input);
        return saved as never;
      },
    }),
    versionService: PromptVersionService.create(),
    read: createApiFixture<PromptReadService>(),
    tagLookup: createApiFixture<PromptTagLookupService>(),
    toVersionedPrompt: () => ({}) as never,
    modelProviders: createApiFixture(),
  });

  return { writes, stored };
}

function newPrompt(model: string) {
  return {
    projectId: "project-1",
    organizationId: "organization-1",
    handle: "support-reply",
    prompt: "Answer kindly.",
    model,
  };
}

function promptUpdate(model: string) {
  return {
    idOrHandle: "support-reply",
    projectId: "project-1",
    data: { commitMessage: "switch model", model },
  };
}

describe("PromptWriteService with Instant Evals as the model", () => {
  describe("when a new prompt names it", () => {
    /** @scenario "Saving Instant Evals as the model of anything but a judge is refused" */
    it("refuses as a client error and stores nothing", async () => {
      const { writes, stored } = promptWrites();

      await expect(writes.createPrompt(newPrompt(INSTANT_EVAL_JUDGE_MODEL_ID))).rejects.toThrow(
        InstantEvalJudgeOnlyModelError,
      );
      expect(stored).toEqual([]);
    });
  });

  describe("when a prompt update names it", () => {
    /** @scenario "Saving Instant Evals as the model of anything but a judge is refused" */
    it("refuses as a client error and stores nothing", async () => {
      const { writes, stored } = promptWrites();

      await expect(
        writes.updatePrompt(promptUpdate(INSTANT_EVAL_JUDGE_MODEL_ID) as never),
      ).rejects.toThrow(InstantEvalJudgeOnlyModelError);
      expect(stored).toEqual([]);
    });
  });

  describe("when the prompt names any other model", () => {
    /** @scenario "A prompt or an agent with any other model still saves" */
    it("stores the new prompt and the update", async () => {
      const { writes, stored } = promptWrites();

      await writes.createPrompt(newPrompt("openai/gpt-5-mini"));
      await writes.updatePrompt(promptUpdate("openai/gpt-5-mini") as never);

      expect(stored).toHaveLength(2);
    });
  });
});

/** A prompt whose one stored version names `model`, for a restore of that version. */
function promptRestores(model: string) {
  const restored: unknown[] = [];
  const writes = PromptWriteService.create({
    repository: createApiFixture<LlmConfigRepository>({
      versions: createApiFixture<LlmConfigRepository["versions"]>({
        findVersionById: async ({ versionId, projectId }) =>
          ({
            id: versionId,
            projectId,
            configId: "config-1",
            configData: { prompt: "Answer kindly.", model },
          }) as never,
        restoreVersion: async (input) => {
          restored.push(input);
          return { configId: "config-1" } as never;
        },
      }),
    }),
    versionService: PromptVersionService.create(),
    read: createApiFixture<PromptReadService>({ getPromptByIdOrHandle: async () => ({}) as never }),
    tagLookup: createApiFixture<PromptTagLookupService>(),
    toVersionedPrompt: () => ({}) as never,
    modelProviders: createApiFixture(),
  });

  return { writes, restored };
}

const restore = {
  versionId: "version-1",
  projectId: "project-1",
  organizationId: "organization-1",
};

describe("PromptWriteService restoring a version", () => {
  describe("when the version names Instant Evals", () => {
    /** @scenario "Saving Instant Evals as the model of anything but a judge is refused" */
    it("refuses as a client error and adds no version", async () => {
      const { writes, restored } = promptRestores(INSTANT_EVAL_JUDGE_MODEL_ID);

      await expect(writes.restoreVersion(restore)).rejects.toThrow(InstantEvalJudgeOnlyModelError);
      expect(restored).toEqual([]);
    });
  });

  describe("when the version names any other model", () => {
    /** @scenario "Copying, restoring or duplicating on any other model still saves" */
    it("adds the restored version", async () => {
      const { writes, restored } = promptRestores("openai/gpt-5-mini");

      await writes.restoreVersion(restore);

      expect(restored).toHaveLength(1);
    });
  });
});

describe("a prompt version stored with Instant Evals before the rule", () => {
  /** @scenario "A prompt or an agent stored with Instant Evals before this rule still reads" */
  it("reads as stored", () => {
    const stored = {
      id: "version-1",
      projectId: "project-1",
      configId: "config-1",
      schemaVersion: "1.0",
      commitMessage: "Initial version",
      version: 1,
      createdAt: new Date(0),
      configData: {
        prompt: "Answer kindly.",
        outputs: [{ identifier: "output", type: "str" }],
        model: INSTANT_EVAL_JUDGE_MODEL_ID,
      },
    };

    expect(parseLlmConfigVersion(stored).configData.model).toBe(INSTANT_EVAL_JUDGE_MODEL_ID);
  });
});
