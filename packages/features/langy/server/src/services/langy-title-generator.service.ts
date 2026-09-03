/**
 * The title a conversation gets when nobody named it.
 *
 * Moved here from the retired application, which is where it had to live while
 * `getVercelAIModel` was reachable only through the app's own module graph.
 * Nothing about the work was ever the application's: the transcript comes from
 * this package's own trusted message reader, the prompt and the character
 * budget are Langy's, and the model handle is a port.
 *
 * Everything the model call can do wrong ends in the same place — the
 * conversation keeps the title it has. That is deliberate and it is the whole
 * error contract of this service: a title is a convenience, and a failed title
 * call must never fail the turn that asked for one. It is logged at `warn`
 * rather than swallowed, because "the transcript was empty" and "the model
 * refused" are different facts and a deployment reading neither cannot tell
 * which it has.
 */
import { LANGY_TITLE_GENERATION } from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import { generateText } from "ai";
import type { LangyTitleGenerator } from "../ports/langy-effect.port";
import type { LangyTitleModelPort } from "../ports/langy-title-model.port";
import type { LangyTrustedMessageReader } from "./langy-message.service";

const logger = createLogger("langwatch:langy:title-generator");

/** The cascade key a project may point at a model of its own. */
export const LANGY_TITLE_FEATURE_KEY = "langy.conversation_title";

const TITLE_SYSTEM_PROMPT = [
  "You write a very short, specific title for a chat between the user and the",
  "LangWatch assistant. Summarize what the user is trying to do.",
  `Rules: at most ${LANGY_TITLE_GENERATION.MAX_TITLE_CHARS} characters; no`,
  "surrounding quotes; no trailing punctuation; Title Case; no prefix like",
  '"Title:". Output ONLY the title, nothing else.',
].join(" ");

export type LangyTitleGeneratorDeps = Readonly<{
  /** The transcript, off the conversation's own message projection. */
  messages: LangyTrustedMessageReader;
  /** Where the model handle comes from; see {@link LangyTitleModelPort}. */
  models: LangyTitleModelPort;
}>;

/**
 * The generator, bound to one message reader and one model gateway.
 *
 * A class holding the two collaborators rather than a closure over them,
 * because {@link LangyTitleGeneratorService.generator} is the shape the effect
 * ports take and the sanitiser is the shape a test reaches for — two callers,
 * one instance, and neither can be handed a differently-composed half.
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

  async generate(input: {
    projectId: string;
    conversationId: string;
  }): Promise<{ title: string; model: string } | null> {
    const { projectId, conversationId } = input;
    try {
      const records = await this.deps.messages.getRecordsByConversation({
        conversationId,
        projectId,
      });
      const transcript = buildTranscript(records);
      if (!transcript) return null;

      const model = await this.deps.models.resolveTitleModel({
        projectId,
        featureKey: LANGY_TITLE_FEATURE_KEY,
        fallbackModel: LANGY_TITLE_GENERATION.MODEL,
      });
      const { text } = await generateText({
        model,
        system: TITLE_SYSTEM_PROMPT,
        prompt: `Conversation so far:\n\n${transcript}\n\nTitle:`,
        temperature: 0.2,
        maxRetries: 1,
      });

      const title = sanitizeTitle(text);
      // The AI SDK's handle is either a model object or the bare id string a
      // provider registry resolves later, and the fact recorded on the
      // conversation is which model wrote the title — so both shapes answer it
      // rather than one of them recording `undefined`.
      const modelId = typeof model === "string" ? model : model.modelId;
      return title ? { title, model: modelId } : null;
    } catch (error) {
      logger.warn(
        {
          projectId,
          conversationId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Langy title model call failed — leaving title unchanged",
      );
      return null;
    }
  }
}

/**
 * What a model actually returns, reduced to a title.
 *
 * Every rule here answers something a model has been seen to do: fence the
 * answer, prefix it with "Title:", quote it, or end it with a full stop. The
 * character budget is applied LAST, after the trimming, so a title that only
 * exceeded it because of a fence is not truncated for it.
 */
function sanitizeTitle(raw: string): string {
  let title = raw.trim();
  title = title.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "");
  title = title.replace(/^(?:title|chat|conversation)\s*[:=]\s*/i, "");

  if (
    (title.startsWith('"') && title.endsWith('"')) ||
    (title.startsWith("'") && title.endsWith("'"))
  ) {
    title = title.slice(1, -1);
  }

  title = title.replace(/[.\s]+$/, "").trim();
  if (title.length > LANGY_TITLE_GENERATION.MAX_TITLE_CHARS) {
    title = title.slice(0, LANGY_TITLE_GENERATION.MAX_TITLE_CHARS).trim();
  }

  return title;
}

/**
 * The last few messages, one per line, each truncated.
 *
 * Both bounds are the contract's rather than this file's: a conversation that
 * has run for an hour must not turn one title call into the most expensive
 * request the deployment makes.
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
