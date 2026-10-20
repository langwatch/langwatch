// Session facts for agents that name their spans by GenAI operation (ADR-039 §Extension):
// each reads the detected agent's declarations, so callers never compare vendor literals.

import type { GenAiOperationRole } from "./coding-agent-definition.ts";
import { CODING_AGENT_REGISTRY } from "./index.ts";

/** The fact a model call's AI units ride on, in whole units: never a dollar figure. */
export const AI_UNITS_SESSION_FACT = "langwatch.session.ai_units";

/** The receiver-stamped ingestion source type, which tells one agent's surfaces apart. */
const SOURCE_TYPE_ATTRIBUTE = "langwatch.ingestion_source.source_type";

const NANO_PER_UNIT = 1_000_000_000;
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

/** Agents whose keyless spans are ambient telemetry, never a session of their own trace. */
export const SPANS_REQUIRE_SESSION_KEY_AGENT_IDS: ReadonlySet<string> = new Set(
  CODING_AGENT_REGISTRY.filter((agent) => agent.spansRequireSessionKey === true).map(
    (agent) => agent.id,
  ),
);

/** The declared AI-unit count and surface one span carries, as session facts. */
export function declaredSpanSessionFacts({
  agent,
  attributes,
}: {
  agent: string;
  attributes: Record<string, unknown>;
}): Record<string, string | number> {
  const definition = definitionOf(agent);
  if (definition === undefined) return {};
  const facts: Record<string, string | number> = {};

  const nanoAiUnits = (definition.nanoAiUnitAttributes ?? [])
    .map((key) => Number(attributes[key]))
    .find((value) => Number.isFinite(value) && value > 0);
  if (nanoAiUnits !== undefined) facts[AI_UNITS_SESSION_FACT] = nanoAiUnits / NANO_PER_UNIT;

  const sourceType = attributes[SOURCE_TYPE_ATTRIBUTE];
  const surface =
    typeof sourceType === "string" ? definition.surfaceBySourceType?.[sourceType] : undefined;
  if (surface !== undefined) facts["app.entrypoint"] = surface;

  return facts;
}
