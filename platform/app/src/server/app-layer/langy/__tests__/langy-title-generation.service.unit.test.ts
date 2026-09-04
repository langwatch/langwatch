/**
 * @vitest-environment node
 *
 * The title generator's two answers. A filmed run lost four of six conversation
 * titles to transient model failures, and nothing ever tried again: the
 * generator swallowed every error and the process treats one request per
 * conversation as final. Failures that a retry can fix must reach the outbox.
 *
 * @see specs/langy/langy-conversation-title.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelNotConfiguredError } from "~/server/modelProviders/modelNotConfiguredError";
import type { LangyTrustedMessageReader } from "../langy-message.service";
import { createLangyConversationTitleGenerator } from "../langy-title-generation.service";

const generateText = vi.fn();
vi.mock("ai", () => ({ generateText: (args: unknown) => generateText(args) }));

const records = [
  { id: "msg_1", role: "user", content: "instrument my traces with langwatch" },
];

function messages(rows = records): LangyTrustedMessageReader {
  return {
    getRecordsByConversation: vi.fn().mockResolvedValue(rows),
  } as unknown as LangyTrustedMessageReader;
}

/** A model resolver standing in for the project's own model configuration. */
function resolver(impl: () => unknown) {
  return vi.fn(impl) as never;
}

const args = { projectId: "project_1", conversationId: "langyconv_1" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createLangyConversationTitleGenerator", () => {
  describe("given the model answers", () => {
    it("returns the sanitized title and the model that produced it", async () => {
      generateText.mockResolvedValue({
        text: "Instrument Traces With LangWatch",
      });
      const generate = createLangyConversationTitleGenerator({
        messages: messages(),
        resolveModel: resolver(() => ({ modelId: "openai/gpt-5-mini" })),
      });

      await expect(generate(args)).resolves.toEqual({
        title: "Instrument Traces With LangWatch",
        model: "openai/gpt-5-mini",
      });
    });
  });

  describe("when the model call fails on a provider blip", () => {
    /** @scenario "A model failure is retried instead of losing the title" */
    it("raises the failure so the process outbox retries it", async () => {
      generateText.mockRejectedValue(
        new Error('Model "openai/gpt-5-mini" provider "openai" is disabled.'),
      );
      const generate = createLangyConversationTitleGenerator({
        messages: messages(),
        resolveModel: resolver(() => ({ modelId: "openai/gpt-5-mini" })),
      });

      await expect(generate(args)).rejects.toThrow(/disabled/);
    });
  });

  describe("when resolving the model fails for a reason a retry could fix", () => {
    it("raises that too", async () => {
      const generate = createLangyConversationTitleGenerator({
        messages: messages(),
        resolveModel: resolver(() => {
          throw new Error("provider openai is currently disabled");
        }),
      });

      await expect(generate(args)).rejects.toThrow(/currently disabled/);
    });
  });

  describe("when the project has no model configured for titles", () => {
    /** @scenario "A project with no model for titles is not retried" */
    it("produces no title and raises nothing", async () => {
      const generate = createLangyConversationTitleGenerator({
        messages: messages(),
        resolveModel: resolver(() => {
          throw new ModelNotConfiguredError(
            "langy.conversation_title",
            "FAST",
            "Langy chat titles",
            "project_1",
          );
        }),
      });

      await expect(generate(args)).resolves.toBeNull();
      expect(generateText).not.toHaveBeenCalled();
    });
  });

  describe("when the transcript holds no text", () => {
    /** @scenario "A conversation with nothing to read is not retried" */
    it("produces no title and never asks the model", async () => {
      const generate = createLangyConversationTitleGenerator({
        messages: messages([]),
        resolveModel: resolver(() => ({ modelId: "openai/gpt-5-mini" })),
      });

      await expect(generate(args)).resolves.toBeNull();
      expect(generateText).not.toHaveBeenCalled();
    });
  });

  describe("when the model answers with nothing usable", () => {
    it("produces no title", async () => {
      generateText.mockResolvedValue({ text: "   " });
      const generate = createLangyConversationTitleGenerator({
        messages: messages(),
        resolveModel: resolver(() => ({ modelId: "openai/gpt-5-mini" })),
      });

      await expect(generate(args)).resolves.toBeNull();
    });
  });
});
