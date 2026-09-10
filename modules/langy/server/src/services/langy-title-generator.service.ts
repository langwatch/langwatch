/**
 * The title a conversation gets when nobody named it. Moved here from the retired application,
 * which is where it had to live while `getVercelAIModel` was reachable only through the app's own
 * module graph.
 */
import { LANGY_TITLE_GENERATION } from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import { generateText } from "ai";
import type { LangyTitleGenerator } from "../app/langy.infrastructure.ts";
import type { LangyTitleModel } from "../app/langy.infrastructure.ts";
import { ModelNotConfiguredError } from "@langwatch/model-provider-contract";
import { normalizeLangyConversationTitle } from "../rules/langy-conversation-title.rules.ts";
import type { LangyTrustedMessageReader } from "./langy-message.service.ts";

const logger = createLogger("langwatch:langy:title-generator");

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
  /** Where the model handle comes from; see {@link LangyTitleModel}. */
  models: LangyTitleModel;
}>;

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
    return (input) => this.tryGenerate(input);
  }

  async tryGenerate(input: {
    projectId: string;
    conversationId: string;
  }): Promise<{ title: string; model: string } | null> {
    const { projectId, conversationId } = input;
    const records = await this.deps.messages.getRecordsByConversation({
      conversationId,
      projectId,
    });
    const transcript = buildTranscript(records);
    if (!transcript) {
      return null;
    }

    let model: Awaited<ReturnType<LangyTitleModel["resolveTitleModel"]>>;
    try {
      model = await this.deps.models.resolveTitleModel({
        projectId,
        featureKey: LANGY_TITLE_FEATURE_KEY,
        fallbackModel: LANGY_TITLE_GENERATION.MODEL,
      });
    } catch (error) {
      // Nothing to retry: this project has no model to ask. Every other failure
      // is this attempt's alone, and it throws so the process outbox retries it
      // — a swallowed blip left the conversation on its raw first message for
      // ever.
      if (error instanceof ModelNotConfiguredError) {
        logger.warn(
          { projectId, conversationId },
          "no cheap model configured for Langy titles — leaving title unchanged",
        );

        return null;
      }

      throw error;
    }

    const { text } = await generateText({
      model,
      system: TITLE_SYSTEM_PROMPT,
      prompt: `Conversation so far:\n\n${transcript}\n\nTitle:`,
      temperature: 0.2,
      maxRetries: 1,
    });

    const title = normalizeLangyConversationTitle(text);
    // The AI SDK's handle is either a model object or the bare id string a
    // provider registry resolves later, and the fact recorded on the
    // conversation is which model wrote the title.
    const modelId = typeof model === "string" ? model : model.modelId;

    return title ? { title, model: modelId } : null;
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
