/**
 * Which library patches the `register` preload installs (OTEL-PRELOAD, round 57).
 * Names follow OTEL_NODE_ENABLED_INSTRUMENTATIONS: the package name without
 * `@opentelemetry/instrumentation-`. ioredis is opt-in, as on main.
 */
export const knownInstrumentations = ["aws-sdk", "openai", "ioredis"] as const;
export type InstrumentationName = (typeof knownInstrumentations)[number];

const defaultInstrumentations: readonly InstrumentationName[] = ["aws-sdk", "openai"];

function isKnown(name: string): name is InstrumentationName {
  return knownInstrumentations.some((known) => known === name);
}

function namesIn(list: string | undefined): string[] {
  return (list ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

/** The enabled list replaces the defaults when set; the disabled list then removes. */
export function selectInstrumentations({
  enabled,
  disabled,
}: {
  enabled: string | undefined;
  disabled: string | undefined;
}): { names: InstrumentationName[]; unknown: string[] } {
  const requested = namesIn(enabled);
  const removed = namesIn(disabled);
  const base = requested.length > 0 ? requested.filter(isKnown) : defaultInstrumentations;
  return {
    names: base.filter((name) => !removed.includes(name)),
    unknown: [...requested, ...removed].filter((name) => !isKnown(name)),
  };
}

const maxStatementChars = 256;

/** A Redis span records the command and its key, never the values (main's rule). */
export function redisStatementSerializer(
  commandName: string,
  commandArgs: (string | Buffer | number | unknown[])[],
): string {
  const key = typeof commandArgs[0] === "string" ? commandArgs[0] : "";
  const statement = key ? `${commandName} ${key}` : commandName;
  return statement.length <= maxStatementChars
    ? statement
    : `${statement.slice(0, maxStatementChars - 3)}...`;
}
