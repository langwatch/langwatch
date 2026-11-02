// Session facts for agents that name their spans by GenAI operation (ADR-039 §Extension):
// each reads the detected agent's declarations, so callers never compare vendor literals.

import type { GenAiOperationRole } from "./coding-agent-definition.ts";
import {
  deriveSessionTitleFromPrompt,
  SESSION_TITLE_FALLBACK_FACT_KEY,
} from "./coding-agent-normalization.ts";
import { CODING_AGENT_REGISTRY } from "./index.ts";

/** The fact a model call's AI units ride on, in whole units: never a dollar figure. */
export const AI_UNITS_SESSION_FACT = "langwatch.session.ai_units";

/**
 * The source type the ingest-key receiver stamps on the resource, which tells one agent's surfaces
 * apart. Governance ingestion sources stamp a span attribute instead, but never a Copilot surface.
 */
const SOURCE_TYPE_RESOURCE_ATTRIBUTE = "langwatch.source";

const NANO_PER_UNIT = 1_000_000_000;
const INPUT_MESSAGES_ATTRIBUTE = "gen_ai.input.messages";
const ROLES: readonly GenAiOperationRole[] = ["session", "modelCall", "toolRun"];

function definitionOf(agent: string) {
  return CODING_AGENT_REGISTRY.find((definition) => definition.id === agent);
}

/** The role a span plays in its agent's session; `undeclared` when the agent names none for it. */
export function genAiOperationRoleOf({
  agent,
  name,
}: {
  agent: string;
  name: string;
}): GenAiOperationRole | "undeclared" {
  const operations = definitionOf(agent)?.genAiOperations;
  if (operations === undefined) return "undeclared";
  const operation = name.split(" ", 1)[0];
  return ROLES.find((role) => operations[role] === operation) ?? "undeclared";
}

/**
 * Whether a span writes a row of the per-call fact table: a declared model call of an agent whose
 * calls ride spans only. A log-fed agent's rows come from its logs, so no call counts twice.
 */
export function isSpanFedModelCall({ agent, name }: { agent: string; name: string }): boolean {
  return (
    definitionOf(agent)?.modelCallsOnSpansOnly === true &&
    genAiOperationRoleOf({ agent, name }) === "modelCall"
  );
}

/** The declared AI-unit count, surface and, on a session root, prompt name one span carries. */
export function declaredSpanSessionFacts({
  agent,
  name,
  attributes,
  resourceAttributes,
}: {
  agent: string;
  name: string;
  attributes: Record<string, unknown>;
  resourceAttributes: Record<string, unknown>;
}): Record<string, string | number> {
  const definition = definitionOf(agent);
  if (definition === undefined) return {};
  const facts: Record<string, string | number> = {};

  // A session root carries its turn's user message, the only prompt text a span-only agent sends.
  if (genAiOperationRoleOf({ agent, name }) === "session") {
    const prompt = latestUserTextParts(attributes[INPUT_MESSAGES_ATTRIBUTE]).join("\n");
    const title = deriveSessionTitleFromPrompt(prompt);
    if (title !== null) facts[SESSION_TITLE_FALLBACK_FACT_KEY] = title;
  }

  const nanoAiUnits = (definition.nanoAiUnitAttributes ?? [])
    .map((key) => Number(attributes[key]))
    .find((value) => Number.isFinite(value) && value > 0);
  if (nanoAiUnits !== undefined) facts[AI_UNITS_SESSION_FACT] = nanoAiUnits / NANO_PER_UNIT;

  const sourceType = resourceAttributes[SOURCE_TYPE_RESOURCE_ATTRIBUTE];
  const surface =
    typeof sourceType === "string" ? definition.surfaceBySourceType?.[sourceType] : undefined;
  if (surface !== undefined) facts["app.entrypoint"] = surface;

  return facts;
}

/** The text parts of the last user message in a GenAI semconv message list; none when absent. */
function latestUserTextParts(raw: unknown): string[] {
  let messages: unknown;
  try {
    messages = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return [];
  }
  if (!Array.isArray(messages)) return [];
  const user = messages.findLast(
    (message): message is { content?: unknown; parts?: unknown } =>
      typeof message === "object" &&
      message !== null &&
      "role" in message &&
      message.role === "user",
  );
  if (user === undefined) return [];
  if (typeof user.content === "string") return [user.content];
  if (!Array.isArray(user.parts)) return [];
  return user.parts.flatMap((part: { type?: unknown; content?: unknown; text?: unknown }) => {
    if (part?.type !== "text") return [];
    const text = typeof part.content === "string" ? part.content : part.text;
    return typeof text === "string" ? [text] : [];
  });
}
