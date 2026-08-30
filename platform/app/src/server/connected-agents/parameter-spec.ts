/**
 * A JSON Schema object as the SDK sends it, normalized into the parameter
 * definitions the run dialog and the scheduler read (ADR-128, "Parameters
 * declared by the agent").
 *
 * Only what a run can address survives: string, number and boolean
 * properties, a closed list from `enum`, a default and a description. An
 * unsupported type becomes text, with a note the SDK prints at startup. The
 * name grammar and the caps are the scenario ones, so an agent-declared
 * parameter and a scenario-declared one are one kind of thing.
 */

import {
  MAX_PARAMETER_DESCRIPTION_LENGTH,
  MAX_PARAMETER_OPTIONS,
  MAX_PARAMETER_VALUE_LENGTH,
  MAX_SCENARIO_PARAMETER_DEFINITIONS,
  type ParameterSpec,
  type ScenarioParameterType,
  type ScenarioParameterValue,
  scenarioParameterDefinitionsSchema,
} from "~/server/scenarios/parameters";
import { TURN_FIELD_NAMES } from "./constants";
import { AgentParameterInvalidError } from "./errors";
import { parameterNameSchema } from "./protocol";

export interface NormalizedParameters {
  parameters: ParameterSpec[];
  /** What was changed on the way in, one line each, for the SDK to print. */
  notes: string[];
}

const SCALAR_TYPES: Record<string, ScenarioParameterType> = {
  string: "string",
  number: "number",
  integer: "number",
  boolean: "boolean",
};

/** A property's JSON Schema `type`, as one name, or nothing usable. */
function scalarTypeOf(property: Record<string, unknown>): {
  type: ScenarioParameterType;
  downgraded: boolean;
} {
  const declared = property.type;
  const names = Array.isArray(declared)
    ? declared.filter((name): name is string => typeof name === "string")
    : typeof declared === "string"
      ? [declared]
      : [];
  // `Optional[int]` arrives as `["integer", "null"]`; null adds nothing.
  const concrete = names.filter((name) => name !== "null");
  if (concrete.length === 1) {
    const mapped = SCALAR_TYPES[concrete[0]!];
    if (mapped) return { type: mapped, downgraded: false };
  }
  // An enum with no type is a string list.
  if (concrete.length === 0 && Array.isArray(property.enum)) {
    return { type: "string", downgraded: false };
  }
  return { type: "string", downgraded: true };
}

/** A string the text type accepts, cut to the cap, or nothing. */
function coerceString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.slice(0, MAX_PARAMETER_VALUE_LENGTH);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

/** A scalar the declared type accepts, or nothing. */
function coerceValue(
  value: unknown,
  type: ScenarioParameterType,
): ScenarioParameterValue | undefined {
  switch (type) {
    case "string":
      return coerceString(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? value
        : undefined;
    case "boolean":
      return typeof value === "boolean" ? value : undefined;
  }
}

/** The closed list of one property, cut to the cap, with a note when cut. */
function optionsOf({
  name,
  property,
  type,
  notes,
}: {
  name: string;
  property: Record<string, unknown>;
  type: ScenarioParameterType;
  notes: string[];
}): ScenarioParameterValue[] | undefined {
  if (!Array.isArray(property.enum)) return undefined;
  const values = property.enum
    .map((value) => coerceValue(value, type))
    .filter((value): value is ScenarioParameterValue => value !== undefined);
  if (values.length === 0) return undefined;
  if (values.length > MAX_PARAMETER_OPTIONS) {
    notes.push(
      `"${name}": the option list was cut to the first ${MAX_PARAMETER_OPTIONS} of ${values.length} values`,
    );
    return values.slice(0, MAX_PARAMETER_OPTIONS);
  }
  return values;
}

/** The name checked against the grammar, the reserved names and turn fields. */
function assertUsableName(name: string): void {
  if (TURN_FIELD_NAMES.has(name)) {
    throw new AgentParameterInvalidError({
      name,
      reason: "it is a turn field the platform sends on every call",
    });
  }
  if (!parameterNameSchema.safeParse(name).success) {
    throw new AgentParameterInvalidError({
      name,
      reason:
        "names start with a letter or underscore and hold only letters, digits and underscores, up to 64 characters",
    });
  }
}

/** The property entries of an object schema, within the declaration cap. */
function propertyEntriesOf(
  schema: Record<string, unknown>,
): [string, unknown][] {
  const properties = schema.properties;
  if (
    properties !== undefined &&
    (typeof properties !== "object" ||
      properties === null ||
      Array.isArray(properties))
  ) {
    throw new AgentParameterInvalidError({
      name: null,
      reason: "the schema must be an object schema with named properties",
    });
  }
  const entries = Object.entries((properties ?? {}) as Record<string, unknown>);
  if (entries.length > MAX_SCENARIO_PARAMETER_DEFINITIONS) {
    throw new AgentParameterInvalidError({
      name: null,
      reason: `an agent can declare at most ${MAX_SCENARIO_PARAMETER_DEFINITIONS} parameters, ${entries.length} were sent`,
    });
  }
  return entries;
}

/** The names the schema marks required. */
function requiredNamesOf(schema: Record<string, unknown>): Set<string> {
  return new Set(
    Array.isArray(schema.required)
      ? schema.required.filter(
          (name): name is string => typeof name === "string",
        )
      : [],
  );
}

/** The schema value of one property, or an empty object when it is not one. */
function propertyObjectOf(raw: unknown): Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

/** A secret belongs to the scenario, so the agent may not declare one. */
function assertNotSecret(
  name: string,
  property: Record<string, unknown>,
): void {
  if (property.secret === true || property["x-langwatch-secret"] === true) {
    throw new AgentParameterInvalidError({
      name,
      reason:
        "a secret is declared on the scenario and supplied per run, never by the agent",
    });
  }
}

/** One property as a definition, with what the normalization changed noted. */
function normalizeProperty({
  name,
  raw,
  required,
  notes,
}: {
  name: string;
  raw: unknown;
  required: boolean;
  notes: string[];
}): ParameterSpec {
  assertUsableName(name);
  const property = propertyObjectOf(raw);
  assertNotSecret(name, property);

  const { type, downgraded } = scalarTypeOf(property);
  if (downgraded) {
    notes.push(
      `"${name}": the type ${describeType(property.type)} is not supported and is presented as text`,
    );
  }
  const defaultValue = coerceValue(property.default, type);
  const description =
    typeof property.description === "string"
      ? property.description.slice(0, MAX_PARAMETER_DESCRIPTION_LENGTH)
      : undefined;
  const options = optionsOf({ name, property, type, notes });
  return {
    name,
    type,
    ...(description !== undefined && { description }),
    ...(defaultValue !== undefined && { defaultValue }),
    ...(options !== undefined && { options }),
    ...(required && defaultValue === undefined && { required: true }),
  };
}

/**
 * The scenario schema is the one source of the shape, so what the SDK
 * declared is checked against it once more, exactly as a scenario is.
 */
function assertScenarioShape(parameters: ParameterSpec[]): void {
  const parsed = scenarioParameterDefinitionsSchema.safeParse(parameters);
  if (parsed.success) return;
  const issue = parsed.error.issues[0];
  throw new AgentParameterInvalidError({
    name:
      typeof issue?.path[0] === "number"
        ? (parameters[issue.path[0]]?.name ?? null)
        : null,
    reason: issue?.message ?? "the declaration is not valid",
  });
}

/**
 * Normalizes one JSON Schema object into parameter definitions.
 *
 * @throws {AgentParameterInvalidError} when a name breaks the grammar or is
 *   a turn field, when more than the cap are declared, or when the schema is
 *   not an object schema at all.
 */
export function normalizeParameterSchema(
  schema: Record<string, unknown>,
): NormalizedParameters {
  const entries = propertyEntriesOf(schema);
  const required = requiredNamesOf(schema);
  const notes: string[] = [];
  const parameters = entries.map(([name, raw]) =>
    normalizeProperty({ name, raw, required: required.has(name), notes }),
  );
  assertScenarioShape(parameters);
  return { parameters, notes };
}

function describeType(declared: unknown): string {
  if (typeof declared === "string") return `"${declared}"`;
  if (Array.isArray(declared)) return `"${declared.join(" | ")}"`;
  return "of that property";
}
