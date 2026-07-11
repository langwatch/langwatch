/**
 * Cheap-model title generator for Langy conversations.
 *
 * Reads the recent transcript from `langy_messages` and asks a CHEAP model
 * (gpt-5-mini by default) for a short, specific title. Returns the title plus
 * the model id that produced it, or null when it cannot produce one (no usable
 * transcript, model unavailable, empty output). It never throws — a title is a
 * nicety and its failure must not affect the turn.
 *
 * Wired into the `langyTitleGeneration` reactor at the composition root
 * (presets.ts) via `setGenerator`, so the event-sourcing layer stays free of
 * model-provider and app-layer read dependencies.
 *
 * @see specs/langy/langy-conversation-title.feature
 */
import { generateText } from "ai";
import { LANGY_TITLE_GENERATION } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/constants";
import type { LangyTitleGenerator } from "~/server/event-sourcing/pipelines/langy-conversation-processing/reactors/langyTitleGeneration.reactor";
import { ModelNotConfiguredError } from "~/server/modelProviders/modelNotConfiguredError";
import { getVercelAIModel } from "~/server/modelProviders/utils";
import { createLogger } from "~/utils/logger/server";
import type { LangyMessageService } from "./langy-message.service";

const logger = createLogger("langwatch:langy:title-generator");

/**
 * Feature key the title model resolves against (role FAST — the platform's
 * "cheap / background" model tier). A project can point FAST at a cheap
 * provider (e.g. Bedrock) while keeping DEFAULT on Anthropic/OpenAI, or set a
 * per-feature override for this exact key. See modelProviders/featureRegistry.
 */
const LANGY_TITLE_FEATURE_KEY = "langy.conversation_title";

const TITLE_SYSTEM_PROMPT = [
  "You write a very short, specific title for a chat between a user and the",
  "LangWatch assistant. Summarize what the user is trying to do.",
  `Rules: at most ${LANGY_TITLE_GENERATION.MAX_TITLE_CHARS} characters; no`,
  "surrounding quotes; no trailing punctuation; Title Case; no prefix like",
  '"Title:". Output ONLY the title, nothing else.',
].join(" ");

/** Strip fences/labels/quotes an LLM adds despite instructions, and cap length. */
function sanitizeTitle(raw: string): string {
  let out = raw.trim();
  out = out.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "");
  out = out.replace(/^(?:title|chat|conversation)\s*[:=]\s*/i, "");
  if (
    (out.startsWith('"') && out.endsWith('"')) ||
    (out.startsWith("'") && out.endsWith("'"))
  ) {
    out = out.slice(1, -1);
  }
  out = out.replace(/[.\s]+$/, "").trim();
  if (out.length > LANGY_TITLE_GENERATION.MAX_TITLE_CHARS) {
    out = out.slice(0, LANGY_TITLE_GENERATION.MAX_TITLE_CHARS).trim();
  }
  return out;
}

/** Render the recent transcript into a compact prompt block. */
function buildTranscript(
  messages: { role: string; content: string }[],
): string {
  return messages
    .map((m) => ({
      role: m.role,
      content: (m.content ?? "").trim(),
    }))
    .filter((m) => m.content.length > 0)
    .slice(-LANGY_TITLE_GENERATION.PROMPT_MESSAGE_LIMIT)
    .map(
      (m) =>
        `${m.role}: ${m.content.slice(0, LANGY_TITLE_GENERATION.PROMPT_CHARS_PER_MESSAGE)}`,
    )
    .join("\n");
}

/**
 * Resolve the cheap title model. Prefers the project's configured FAST-role
 * model (so titles can run on e.g. Bedrock independently of the DEFAULT chat
 * model); if no FAST model is configured, falls back to the cheap default so
 * titles still work out of the box.
 */
async function resolveTitleModel(
  projectId: string,
  resolveModel: typeof getVercelAIModel,
) {
  try {
    return await resolveModel({
      projectId,
      featureKey: LANGY_TITLE_FEATURE_KEY,
    });
  } catch (error) {
    if (!(error instanceof ModelNotConfiguredError)) throw error;
    // No cheap model configured for this project — use the sensible default.
    return await resolveModel({
      projectId,
      model: LANGY_TITLE_GENERATION.MODEL,
    });
  }
}

/**
 * Build the reactor's title generator. `resolveModel` is injectable for tests;
 * it defaults to the real project model-provider path (`getVercelAIModel`),
 * resolving the FAST (cheap) role.
 */
export function createLangyConversationTitleGenerator(deps: {
  messages: Pick<LangyMessageService, "getRecordsByConversation">;
  resolveModel?: typeof getVercelAIModel;
}): LangyTitleGenerator {
  const resolveModel = deps.resolveModel ?? getVercelAIModel;

  return async ({ projectId, conversationId }) => {
    try {
      const records = await deps.messages.getRecordsByConversation({
        conversationId,
        projectId,
      });
      const transcript = buildTranscript(records);
      if (!transcript) return null;

      const model = await resolveTitleModel(projectId, resolveModel);

      const { text } = await generateText({
        model,
        system: TITLE_SYSTEM_PROMPT,
        prompt: `Conversation so far:\n\n${transcript}\n\nTitle:`,
        temperature: 0.2,
        maxRetries: 1,
      });

      const title = sanitizeTitle(text);
      if (!title) return null;
      // Record the model that actually produced the title, not the request key.
      return { title, model: model.modelId };
    } catch (error) {
      // Resilient no-op: an unconfigured provider or a provider blip should
      // leave the existing title untouched, never bubble to the reactor.
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
