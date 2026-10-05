/**
 * The title a conversation gets when nobody named it, written by the project's cheap model
 * through model-provider, which keeps the vendor handle to itself.
 * @see specs/langy/langy-conversation-title.feature
 */
import { HandledError } from "@langwatch/handled-error";
import { LANGY_TITLE_GENERATION } from "@langwatch/langy-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";

import { normalizeLangyConversationTitle } from "../rules/langy-conversation-title.rules.ts";
import type { LangyTrustedMessageReader } from "./langy-message.service.ts";

/**
 * Generates a conversation title from the transcript so far, or null when
 * the transcript is empty or the model call failed. Declared here since
 * the effect ports are its only consumer.
 */
export type LangyTitleGenerator = (input: {
  projectId: string;
  conversationId: string;
}) => Promise<LangyGeneratedTitle>;

/** A title and the model that wrote it, or `unchanged` when the conversation keeps its title. */
export type LangyGeneratedTitle =
  | { outcome: "generated"; title: string; model: string }
  | { outcome: "unchanged" };

const logger = createLogger("langwatch:langy:title-generator");

const UNCHANGED: LangyGeneratedTitle = { outcome: "unchanged" };

/** The cascade key a project may point at a model of its own. */
export const LANGY_TITLE_FEATURE_KEY = "langy.conversation_title";

const TITLE_SYSTEM_PROMPT = [
  "You write a very short, specific title for a chat between the user and the",
  "LangWatch assistant. Summarize what the user is trying to do.",
  `Rules: at most ${LANGY_TITLE_GENERATION.MAX_TITLE_CHARS} characters;`,
  "sentence case, so only the first word starts with a capital, apart from",
  "product and proper names such as LangWatch, GitHub or Python; no",
  "surrounding quotes; no trailing period; no prefix like",
  '"Title:". Output ONLY the title, nothing else.',
].join(" ");

export type LangyTitleGeneratorDeps = Readonly<{
  /** The transcript, off the conversation's own message projection. */
  messages: LangyTrustedMessageReader;
  /** The project's model for the title key, and the completion run on it. */
  models: Pick<ModelProviderApi, "resolveModelForFeature" | "generateText">;
}>;

/** Nothing to retry: this project has no model to ask. */
function isModelNotConfigured(error: unknown): boolean {
  return HandledError.isHandled(error) && error.code === "model_not_configured";
}

/**
 * The generator, bound to one message reader and one model gateway.
 */
export class LangyTitleGeneratorService {
  static create(deps: LangyTitleGeneratorDeps): LangyTitleGeneratorService {
    return new LangyTitleGeneratorService(deps);
  }

  private constructor(private readonly deps: LangyTitleGeneratorDeps) {}

  /** The generator as the conversation runtime's effect ports take it. */
  generator(): LangyTitleGenerator {
    return (input) => this.generate(input);
  }

  /** Every failure but an unconfigured model throws, so the process outbox retries it. */
  async generate(input: {
    projectId: string;
    conversationId: string;
  }): Promise<LangyGeneratedTitle> {
    const { projectId, conversationId } = input;
    const records = await this.deps.messages.getRecordsByConversation({
      conversationId,
      projectId,
    });
    const transcript = buildTranscript(records);
    if (!transcript) {
      return UNCHANGED;
    }

    try {
      const model = await this.titleModel(projectId);
      const { text } = await this.deps.models.generateText({
        projectId,
        featureKey: LANGY_TITLE_FEATURE_KEY,
        ...(model.fallback ? { model: model.name } : {}),
        system: TITLE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Conversation so far:\n\n${transcript}\n\nTitle:` }],
        temperature: 0.2,
        maxRetries: 1,
      });
      const title = normalizeLangyConversationTitle(text);

      return title ? { outcome: "generated", title, model: model.name } : UNCHANGED;
    } catch (error) {
      if (!isModelNotConfigured(error)) throw error;
      logger.warn(
        { projectId, conversationId },
        "no cheap model configured for Langy titles — leaving title unchanged",
      );

      return UNCHANGED;
    }
  }

  /** The project's model for titles, else the cheap default so titles work out of the box. */
  private async titleModel(projectId: string): Promise<{ name: string; fallback: boolean }> {
    try {
      const resolved = await this.deps.models.resolveModelForFeature({
        projectId,
        featureKey: LANGY_TITLE_FEATURE_KEY,
      });

      return { name: resolved.model, fallback: false };
    } catch (error) {
      if (!isModelNotConfigured(error)) throw error;

      return { name: LANGY_TITLE_GENERATION.MODEL, fallback: true };
    }
  }
}

/**
 * The last few messages, one per line, each truncated. Both bounds are the contract's rather than
 * this file's: a conversation that has run for an hour must not turn one title call into the most
 * expensive request the deployment makes.
 */
function buildTranscript(messages: { role: string; content: string }[]): string {
  return messages
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }))
    .filter((message) => message.content.length > 0)
    .slice(-LANGY_TITLE_GENERATION.PROMPT_MESSAGE_LIMIT)
    .map(
      (message) =>
        `${message.role}: ${message.content.slice(0, LANGY_TITLE_GENERATION.PROMPT_CHARS_PER_MESSAGE)}`,
    )
    .join("\n");
}
