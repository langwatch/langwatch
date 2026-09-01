import { LANGY_TITLE_GENERATION } from "@langwatch/langy-contract";
import type { LangyTitleGenerator } from "@langwatch/langy-server";
import { createLogger } from "@langwatch/observability";
import { generateText } from "ai";
import {
  ModelNotConfiguredError,
  type ModelProviderService,
} from "@langwatch/model-provider-contract";
import type { ManagedProviderService } from "@langwatch/enterprise-managed-provider-contract";
import { getVercelAIModel } from "~/server/modelProviders/utils";

/**
 * The model services the title call runs on. `getVercelAIModel` resolves the
 * cascade through the provider service and the managed-provider service, so
 * both arrive from the composition root rather than being reached for here.
 */
type LangyTitleModelServices = {
  modelProviders: ModelProviderService;
  managedProviders: ManagedProviderService;
};

type LangyTrustedMessageReader = {
  getRecordsByConversation(input: {
    conversationId: string;
    projectId: string;
  }): Promise<Array<{ role: string; content: string }>>;
};

const logger = createLogger("langwatch:langy:title-generator");
const titleFeatureKey = "langy.conversation_title";

const titleSystemPrompt = [
  "You write a very short, specific title for a chat between the user and the",
  "LangWatch assistant. Summarize what the user is trying to do.",
  `Rules: at most ${LANGY_TITLE_GENERATION.MAX_TITLE_CHARS} characters; no`,
  "surrounding quotes; no trailing punctuation; Title Case; no prefix like",
  '"Title:". Output ONLY the title, nothing else.',
].join(" ");

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

async function resolveTitleModel({
  projectId,
  modelProviders,
  managedProviders,
}: LangyTitleModelServices & { projectId: string }) {
  try {
    return await getVercelAIModel({
      projectId,
      featureKey: titleFeatureKey,
      modelProviders,
      managedProviders,
    });
  } catch (error) {
    if (!(error instanceof ModelNotConfiguredError)) throw error;
    return getVercelAIModel({
      projectId,
      model: LANGY_TITLE_GENERATION.MODEL,
      modelProviders,
      managedProviders,
    });
  }
}

export function createLangyConversationTitleGenerator(
  input: LangyTitleModelServices & {
    messages: LangyTrustedMessageReader;
  },
): LangyTitleGenerator {
  return async ({ projectId, conversationId }) => {
    try {
      const records = await input.messages.getRecordsByConversation({
        conversationId,
        projectId,
      });
      const transcript = buildTranscript(records);
      if (!transcript) return null;

      const model = await resolveTitleModel({
        projectId,
        modelProviders: input.modelProviders,
        managedProviders: input.managedProviders,
      });
      const { text } = await generateText({
        model,
        system: titleSystemPrompt,
        prompt: `Conversation so far:\n\n${transcript}\n\nTitle:`,
        temperature: 0.2,
        maxRetries: 1,
      });

      const title = sanitizeTitle(text);
      return title ? { title, model: model.modelId } : null;
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
  };
}
