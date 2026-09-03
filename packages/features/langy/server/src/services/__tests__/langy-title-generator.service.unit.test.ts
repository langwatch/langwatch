/**
 * @vitest-environment node
 *
 * The title generator, as it behaves once the model has answered.
 *
 * It moved out of the retired application whole, and everything worth pinning
 * is about what it does with an answer rather than how it got one: the
 * transcript it builds, the shapes it strips off a title, and the one thing it
 * must never do, which is fail the turn that asked for a title.
 */
import { LANGY_TITLE_GENERATION } from "@langwatch/langy-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({ generateText: vi.fn() }));

import { generateText } from "ai";
import { LangyTitleModelPort } from "../../ports/langy-title-model.port";
import { LangyTitleGeneratorService } from "../langy-title-generator.service";
import type { LangyMessageRecord, LangyTrustedMessageReader } from "../langy-message.service";

const mockGenerateText = vi.mocked(generateText);

const PROJECT_ID = "project-1";
const CONVERSATION_ID = "conversation-1";

/** The resolver, recording what the service asked it for. */
class RecordingTitleModel extends LangyTitleModelPort {
  readonly asked: Array<{ projectId: string; featureKey: string; fallbackModel: string }> = [];

  constructor(private readonly answer: unknown = { modelId: "openai/gpt-5-mini" }) {
    super();
  }

  resolveTitleModel(input: {
    projectId: string;
    featureKey: string;
    fallbackModel: string;
  }): Promise<never> {
    this.asked.push(input);
    return Promise.resolve(this.answer) as Promise<never>;
  }
}

/** A resolver that cannot answer, for the failure contract. */
class RefusingTitleModel extends LangyTitleModelPort {
  resolveTitleModel(): Promise<never> {
    return Promise.reject(new Error("no model gateway on this deployment"));
  }
}

function messagesOf(records: Array<{ role: string; content: string }>): LangyTrustedMessageReader {
  return {
    getRecordsByConversation: async () =>
      records.map((record, index) => ({
        id: `message-${index}`,
        role: record.role,
        content: record.content,
      })) as LangyMessageRecord[],
  };
}

function generatorOver(input: {
  records: Array<{ role: string; content: string }>;
  models?: LangyTitleModelPort;
}) {
  const models = input.models ?? new RecordingTitleModel();
  return {
    models,
    service: LangyTitleGeneratorService.create({
      messages: messagesOf(input.records),
      models,
    }),
  };
}

describe("given a conversation the customer never named", () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  describe("when the model answers with a usable title", () => {
    it("returns it with the model that wrote it", async () => {
      mockGenerateText.mockResolvedValue({ text: "Debugging A Failing Evaluation" } as never);
      const { service } = generatorOver({
        records: [{ role: "user", content: "why did my evaluation fail" }],
      });

      await expect(
        service.generate({ projectId: PROJECT_ID, conversationId: CONVERSATION_ID }),
      ).resolves.toEqual({ title: "Debugging A Failing Evaluation", model: "openai/gpt-5-mini" });
    });

    it("asks the cascade for the conversation-title key, naming the fallback", async () => {
      mockGenerateText.mockResolvedValue({ text: "A Title" } as never);
      const { service, models } = generatorOver({
        records: [{ role: "user", content: "hello" }],
      });

      await service.generate({ projectId: PROJECT_ID, conversationId: CONVERSATION_ID });

      expect((models as RecordingTitleModel).asked).toEqual([
        {
          projectId: PROJECT_ID,
          featureKey: "langy.conversation_title",
          fallbackModel: LANGY_TITLE_GENERATION.MODEL,
        },
      ]);
    });

    it("sends only the last few messages, each truncated", async () => {
      mockGenerateText.mockResolvedValue({ text: "A Title" } as never);
      const overLimit = LANGY_TITLE_GENERATION.PROMPT_MESSAGE_LIMIT + 3;
      const { service } = generatorOver({
        records: Array.from({ length: overLimit }, (_, index) => ({
          role: "user",
          content: `${index}`.padEnd(LANGY_TITLE_GENERATION.PROMPT_CHARS_PER_MESSAGE + 50, "x"),
        })),
      });

      await service.generate({ projectId: PROJECT_ID, conversationId: CONVERSATION_ID });

      const prompt = String(mockGenerateText.mock.calls[0]?.[0]?.prompt);
      const lines = prompt.split("\n").filter((line) => line.startsWith("user: "));
      expect(lines).toHaveLength(LANGY_TITLE_GENERATION.PROMPT_MESSAGE_LIMIT);
      // The first message kept is the one `PROMPT_MESSAGE_LIMIT` from the end,
      // so an hour-old conversation cannot turn one title call into the most
      // expensive request the deployment makes.
      expect(lines[0]).toContain(`${overLimit - LANGY_TITLE_GENERATION.PROMPT_MESSAGE_LIMIT}`);
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(
          "user: ".length + LANGY_TITLE_GENERATION.PROMPT_CHARS_PER_MESSAGE,
        );
      }
    });
  });

  describe("when the model dresses its answer up", () => {
    it.each([
      ['"Quoted Title"', "Quoted Title"],
      ["Title: Prefixed Answer", "Prefixed Answer"],
      ["```\nFenced Answer\n```", "Fenced Answer"],
      ["Trailing Punctuation.", "Trailing Punctuation"],
    ])("reduces %j to the title itself", async (raw, expected) => {
      mockGenerateText.mockResolvedValue({ text: raw } as never);
      const { service } = generatorOver({ records: [{ role: "user", content: "hello" }] });

      await expect(
        service.generate({ projectId: PROJECT_ID, conversationId: CONVERSATION_ID }),
      ).resolves.toMatchObject({ title: expected });
    });

    it("holds the title inside the character budget", async () => {
      mockGenerateText.mockResolvedValue({
        text: "x".repeat(LANGY_TITLE_GENERATION.MAX_TITLE_CHARS + 40),
      } as never);
      const { service } = generatorOver({ records: [{ role: "user", content: "hello" }] });

      const generated = await service.generate({
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
      });

      expect(generated?.title.length).toBe(LANGY_TITLE_GENERATION.MAX_TITLE_CHARS);
    });
  });

  describe("when there is nothing to summarise", () => {
    it("answers nothing without calling a model at all", async () => {
      const { service } = generatorOver({ records: [{ role: "user", content: "   " }] });

      await expect(
        service.generate({ projectId: PROJECT_ID, conversationId: CONVERSATION_ID }),
      ).resolves.toBeNull();
      expect(mockGenerateText).not.toHaveBeenCalled();
    });
  });

  describe("when the model call cannot be made", () => {
    /**
     * The whole error contract, in one assertion: a title is a convenience and
     * a failed title call must never fail the turn that asked for one.
     */
    it("leaves the title unchanged rather than failing the turn", async () => {
      const { service } = generatorOver({
        records: [{ role: "user", content: "hello" }],
        models: new RefusingTitleModel(),
      });

      await expect(
        service.generate({ projectId: PROJECT_ID, conversationId: CONVERSATION_ID }),
      ).resolves.toBeNull();
    });

    it("does the same when the model answers with nothing usable", async () => {
      mockGenerateText.mockResolvedValue({ text: "  \n  " } as never);
      const { service } = generatorOver({ records: [{ role: "user", content: "hello" }] });

      await expect(
        service.generate({ projectId: PROJECT_ID, conversationId: CONVERSATION_ID }),
      ).resolves.toBeNull();
    });
  });
});
