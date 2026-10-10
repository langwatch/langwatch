import { LANGY_TITLE_GENERATION } from "@langwatch/langy-contract";
import type {
  ModelDefaultResolveInput,
  ModelProviderApi,
  ModelProviderTextGenerationInput,
} from "@langwatch/model-provider-contract";
/**
 * @vitest-environment node
 * Title generator behavior once the model answers: transcript, stripped
 * shapes, and the key the project's model is resolved by.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { LangyTrustedMessageReader } from "../langy-message.service.ts";
import { LangyTitleGeneratorService } from "../langy-title-generator.service.ts";

const PROJECT_ID = "project-1";
const CONVERSATION_ID = "conversation-1";

function messagesOf(records: { role: "user" | "assistant"; content: string }[]) {
  const reader: LangyTrustedMessageReader = {
    getRecordsByConversation: async () =>
      records.map((record, index) => ({ id: `message-${index}`, ...record })),
  };
  return reader;
}

/** model-provider, answering one text and recording what it was asked. */
function generatorOver(input: {
  records: { role: "user" | "assistant"; content: string }[];
  text?: string;
}) {
  const resolved: ModelDefaultResolveInput[] = [];
  const completions: ModelProviderTextGenerationInput[] = [];
  const models = createApiFixture<ModelProviderApi>({
    resolveModelForFeature: async (request) => {
      resolved.push(request);
      return {
        model: "openai/gpt-5-mini",
        source: "role_default",
        scope: "project",
        feature: {
          key: request.featureKey,
          role: "FAST",
          displayName: "Langy chat titles",
          description: "Names each Langy conversation from its messages.",
        },
      };
    },
    generateText: async (request) => {
      completions.push(request);
      return { text: input.text ?? "A Title" };
    },
  });
  const service = LangyTitleGeneratorService.create({
    messages: messagesOf(input.records),
    models,
  });
  return { service, resolved, completions };
}

const call = { projectId: PROJECT_ID, conversationId: CONVERSATION_ID };

describe("given a conversation the customer never named", () => {
  describe("when the model answers with a usable title", () => {
    it("asks model-provider for the conversation-title key", async () => {
      const { service, resolved, completions } = generatorOver({
        records: [{ role: "user", content: "hello" }],
      });

      await service.generate(call);

      expect(resolved).toEqual([{ projectId: PROJECT_ID, featureKey: "langy.conversation_title" }]);
      expect(completions).toMatchObject([
        {
          projectId: PROJECT_ID,
          featureKey: "langy.conversation_title",
          temperature: 0.2,
          maxRetries: 1,
        },
      ]);
    });

    it("sends only the last few messages, each truncated", async () => {
      const overLimit = LANGY_TITLE_GENERATION.PROMPT_MESSAGE_LIMIT + 3;
      const { service, completions } = generatorOver({
        records: Array.from({ length: overLimit }, (_, index) => ({
          role: "user" as const,
          content: `${index}`.padEnd(LANGY_TITLE_GENERATION.PROMPT_CHARS_PER_MESSAGE + 50, "x"),
        })),
      });

      await service.generate(call);

      const prompt = completions[0]?.messages[0]?.content ?? "";
      const lines = prompt.split("\n").filter((line) => line.startsWith("user: "));
      expect(lines).toHaveLength(LANGY_TITLE_GENERATION.PROMPT_MESSAGE_LIMIT);
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
      ['"Quoted Title"', "Quoted title"],
      ["Title: Prefixed Answer", "Prefixed answer"],
      ["```\nFenced Answer\n```", "Fenced answer"],
      ["Trailing Punctuation.", "Trailing punctuation"],
    ])("reduces %j to the title itself", async (raw, expected) => {
      const { service } = generatorOver({
        records: [{ role: "user", content: "hello" }],
        text: raw,
      });

      await expect(service.generate(call)).resolves.toMatchObject({ title: expected });
    });

    it("holds the title inside the character budget", async () => {
      const { service } = generatorOver({
        records: [{ role: "user", content: "hello" }],
        text: "x".repeat(LANGY_TITLE_GENERATION.MAX_TITLE_CHARS + 40),
      });

      const generated = await service.generate(call);

      expect(generated.outcome).toBe("generated");
      expect("title" in generated && generated.title.length).toBe(
        LANGY_TITLE_GENERATION.MAX_TITLE_CHARS,
      );
    });
  });
});
