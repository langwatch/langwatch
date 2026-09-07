/**
 * The user-default layer for a connected agent's declared parameters.
 *
 * A connected agent declares its parameters, and their code defaults, from the
 * function that runs it (ADR-128); those code defaults are replaced wholesale
 * on every SDK reconnect. A user default is a separate, persistent layer the
 * owner sets in the drawer, stored outside `Agent.config` so a re-register
 * cannot clobber it. This module is the framework-free core of that layer: it
 * reads the stored map tolerantly, overlays it onto the declared definitions,
 * names the stale entries, and validates a value the user is about to save.
 *
 * Precedence, resolved downstream: code default < user default < scenario
 * default < run value. The overlay here produces the "code default < user
 * default" step by rewriting each definition's `defaultValue`; the scenario
 * and run layers sit above it in {@link resolveRunParameters}.
 *
 * @see specs/agents/connected-agent-parameter-user-defaults.feature
 * @see dev/docs/adr/128-connected-agents.md
 */

import type {
  ScenarioParameterDefinition,
  ScenarioParameterValue,
} from "~/server/scenarios/parameters";
import { AgentParameterDefaultInvalidError } from "./errors";

/** The user-set defaults of one agent, keyed by declared parameter name. */
export type AgentParameterDefaults = Record<string, ScenarioParameterValue>;

/**
 * Reads the user defaults back off the raw JSON column.
 *
 * Tolerant on purpose, the way the scenario parameter column is read: a shape
 * this version does not understand reads as no defaults rather than taking a
 * run or a drawer down. Only string, number and boolean entries survive; a
 * name whose value is anything else is dropped.
 */
export function parseAgentParameterDefaults(
  raw: unknown,
): AgentParameterDefaults {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  const defaults: AgentParameterDefaults = {};
  for (const [name, value] of Object.entries(raw)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      defaults[name] = value;
    }
  }
  return defaults;
}

/**
 * The declared definitions with each non-secret parameter's `defaultValue`
 * overlaid by the user default of the same name.
 *
 * A secret parameter is left untouched: a secret carries no default and takes
 * no user default. A user default whose name no declaration carries is ignored
 * here (it is stale); see {@link staleParameterDefaultNames}. Every other field
 * of a definition — its type, options, required flag — is preserved.
 */
export function applyUserParameterDefaults({
  definitions,
  userDefaults,
}: {
  definitions: readonly ScenarioParameterDefinition[];
  userDefaults: AgentParameterDefaults;
}): ScenarioParameterDefinition[] {
  return definitions.map((definition) => {
    if (definition.secret === true) return definition;
    if (!Object.hasOwn(userDefaults, definition.name)) return definition;
    return { ...definition, defaultValue: userDefaults[definition.name] };
  });
}

/**
 * The user-default names no current declaration carries.
 *
 * A reconnect that drops a parameter leaves its user default stored but
 * unreferenced. Runtime ignores such a value; the drawer shows it as stale so
 * the user can clear it.
 */
export function staleParameterDefaultNames({
  definitions,
  userDefaults,
}: {
  definitions: readonly ScenarioParameterDefinition[];
  userDefaults: AgentParameterDefaults;
}): string[] {
  const declared = new Set(definitions.map((definition) => definition.name));
  return Object.keys(userDefaults).filter((name) => !declared.has(name));
}

/** The reason a value does not fit the declared type, or null when it fits. */
function typeMismatchReason({
  type,
  value,
}: {
  type: NonNullable<ScenarioParameterDefinition["type"]>;
  value: ScenarioParameterValue;
}): string | null {
  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value)
      ? null
      : "expected a number";
  }
  if (type === "boolean") {
    return typeof value === "boolean" ? null : "expected a boolean";
  }
  return typeof value === "string" ? null : "expected text";
}

/**
 * Refuses a user-default value the current declarations cannot accept, at save
 * time, against the declaration as it stands right now.
 *
 * @throws {AgentParameterDefaultInvalidError} when the name is not declared, is
 *   a secret parameter, the value is of the wrong type, or the value is outside
 *   a declared closed option list.
 */
export function validateUserParameterDefault({
  definitions,
  name,
  value,
}: {
  definitions: readonly ScenarioParameterDefinition[];
  name: string;
  value: ScenarioParameterValue;
}): void {
  const definition = definitions.find((each) => each.name === name);
  if (!definition) {
    throw new AgentParameterDefaultInvalidError({
      name,
      reason: "not declared",
    });
  }
  if (definition.secret === true) {
    throw new AgentParameterDefaultInvalidError({
      name,
      reason: "is a secret",
    });
  }

  // Type absent reads as string, the same rule the resolver reads it by.
  const type = definition.type ?? "string";
  const mismatch = typeMismatchReason({ type, value });
  if (mismatch) {
    throw new AgentParameterDefaultInvalidError({ name, reason: mismatch });
  }

  if (definition.options && !definition.options.includes(value)) {
    throw new AgentParameterDefaultInvalidError({
      name,
      reason: `must be one of: ${definition.options.map(String).join(", ")}`,
    });
  }
}
