import { LANGY_TITLE_GENERATION } from "@langwatch/langy-contract";
import {
  ModelNotConfiguredError,
  type ModelProviderApi,
  type ModelProviderResolution,
} from "@langwatch/model-provider-contract";
/**
 * @vitest-environment node
 * A retry-fixable generation failure must reach the outbox, not vanish silently.
 * @see specs/langy/langy-conversation-title.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { LangyMessageRecord, LangyTrustedMessageReader } from "../langy-message.service.ts";
import { LangyTitleGeneratorService } from "../langy-title-generator.service.ts";

const records: LangyMessageRecord[] = [
  { id: "msg_1", role: "user", content: "instrument my traces with langwatch" },
];
const args = { projectId: "project_1", conversationId: "langyconv_1" };

const RESOLVED: ModelProviderResolution = {
  model: "openai/gpt-5-mini",
  source: "role_default",
  scope: "project",
  feature: {
    key: "langy.conversation_title",
    role: "FAST",
    displayName: "Langy chat titles",
    description: "Names each Langy conversation from its messages.",
  },
};

function messages(rows = records): LangyTrustedMessageReader {
  return { getRecordsByConversation: async () => rows };
}

function unconfigured(): ModelNotConfiguredError {
  return new ModelNotConfiguredError({
    featureKey: "langy.conversation_title",
    role: "FAST",
    featureDisplayName: "Langy chat titles",
    projectId: "project_1",
  });
}

/** The project's model configuration, as model-provider answers for it. */
function modelProviders(
  answers: Partial<Pick<ModelProviderApi, "resolveModelForFeature" | "generateText">>,
) {
  const generateText = vi.fn(answers.generateText ?? (async () => ({ text: "A title" })));
  const api = createApiFixture<ModelProviderApi>({
    resolveModelForFeature: answers.resolveModelForFeature ?? (async () => RESOLVED),
    generateText,
  });
  return { api, generateText };
}

describe("LangyTitleGeneratorService", () => {
  describe("given the model answers", () => {
    /** @scenario "A title in title case is rewritten in sentence case" */
    it("returns the normalized title and the model that produced it", async () => {
      const { api } = modelProviders({
        generateText: async () => ({ text: "Instrument Traces With LangWatch" }),
      });
      const generate = LangyTitleGeneratorService.create({
        messages: messages(),
        models: api,
      }).generator();

      await expect(generate(args)).resolves.toEqual({
        outcome: "generated",
        title: "Instrument traces with LangWatch",
        model: "openai/gpt-5-mini",
      });
    });
  });

  describe("when the model call fails on a provider blip", () => {
    /** @scenario "A model failure is retried instead of losing the title" */
    it("raises the failure so the process outbox retries it", async () => {
      const { api } = modelProviders({
        generateText: async () => {
          throw new Error('Model "openai/gpt-5-mini" provider "openai" is disabled.');
        },
      });
      const generate = LangyTitleGeneratorService.create({
        messages: messages(),
        models: api,
      }).generator();

      await expect(generate(args)).rejects.toThrow(/disabled/);
    });
  });

  describe("when resolving the model fails for a reason a retry could fix", () => {
    it("raises that too", async () => {
      const { api } = modelProviders({
        resolveModelForFeature: async () => {
          throw new Error("provider openai is currently disabled");
        },
      });
      const generate = LangyTitleGeneratorService.create({
        messages: messages(),
        models: api,
      }).generator();

      await expect(generate(args)).rejects.toThrow(/currently disabled/);
    });
  });

  describe("when the project has no model configured for titles", () => {
    /** @scenario "A project with no model for titles falls back to the cheap default" */
    it("generates the title on the cheap default model", async () => {
      const { api, generateText } = modelProviders({
        resolveModelForFeature: async () => {
          throw unconfigured();
        },
        generateText: async () => ({ text: "Instrument traces" }),
      });
      const generate = LangyTitleGeneratorService.create({
        messages: messages(),
        models: api,
      }).generator();

      await expect(generate(args)).resolves.toEqual({
        outcome: "generated",
        title: "Instrument traces",
        model: LANGY_TITLE_GENERATION.MODEL,
      });
      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({ model: LANGY_TITLE_GENERATION.MODEL, maxRetries: 1 }),
      );
    });
  });

  describe("when not even the cheap default can be asked", () => {
    /** @scenario "A project with no model for titles is not retried" */
    it("produces no title and raises nothing", async () => {
      const { api } = modelProviders({
        resolveModelForFeature: async () => {
          throw unconfigured();
        },
        generateText: async () => {
          throw unconfigured();
        },
      });
      const generate = LangyTitleGeneratorService.create({
        messages: messages(),
        models: api,
      }).generator();

      await expect(generate(args)).resolves.toEqual({ outcome: "unchanged" });
    });
  });

  describe("when the transcript holds no text", () => {
    /** @scenario "A conversation with nothing to read is not retried" */
    it("produces no title and never asks the model", async () => {
      const { api, generateText } = modelProviders({});
      const generate = LangyTitleGeneratorService.create({
        messages: messages([]),
        models: api,
      }).generator();

      await expect(generate(args)).resolves.toEqual({ outcome: "unchanged" });
      expect(generateText).not.toHaveBeenCalled();
    });
  });

  describe("when the model answers with nothing usable", () => {
    it("produces no title", async () => {
      const { api } = modelProviders({ generateText: async () => ({ text: "   " }) });
      const generate = LangyTitleGeneratorService.create({
        messages: messages(),
        models: api,
      }).generator();

      await expect(generate(args)).resolves.toEqual({ outcome: "unchanged" });
    });
  });
});
