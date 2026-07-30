import { ConfigurationError } from "../errors";
import type { CamelToSnake } from "./snakeCase";
import { toSnakeCase } from "./snakeCase";

/**
 * Derived type strings (ADR-105 decision 3, decision 8, decision 10).
 *
 * An event's persisted type string derives from the pipeline name, the
 * optional prefix, and the snake-cased map key — with a prefix it is
 * byte-for-byte the legacy dotted string already in `event_log`. An intent's
 * type string derives from the process manager's own name and the intent
 * key, qualified because the outbox is shared across every process manager.
 * Neither is ever authored a second time.
 */

export type EventTypeString<
  Name extends string,
  Key extends string,
  Prefix extends string | undefined = undefined,
> = Prefix extends string
  ? `${Prefix}.${Name}.${CamelToSnake<Key>}`
  : `${Name}/${Key}`;

export function eventTypeOf(args: {
  readonly prefix: string | undefined;
  readonly name: string;
  readonly key: string;
}): string {
  return args.prefix !== undefined
    ? `${args.prefix}.${args.name}.${toSnakeCase(args.key)}`
    : `${args.name}/${args.key}`;
}

export type IntentTypeString<
  ProcessManagerName extends string,
  Key extends string,
> = `${ProcessManagerName}/${Key}`;

export function intentTypeOf(processManagerName: string, key: string): string {
  return `${processManagerName}/${key}`;
}

/** Both separators are structural in the derived type-string forms. */
export function assertNoSeparators(
  value: string,
  what: string,
  context: Record<string, unknown>,
): void {
  if (/[/.]/.test(value)) {
    throw new ConfigurationError(`${what} must not contain "/" or "."`, context);
  }
}

/**
 * `/` is what separates an unprefixed type string's name from its key, so a
 * prefix carrying one would produce an ambiguous derivation. `.` is not
 * forbidden here — a prefix is itself dot-joined (`lw.obs`), and further
 * dot-segments are exactly what it exists to add.
 */
export function assertPrefixIsSafe(
  value: string,
  what: string,
  context: Record<string, unknown>,
): void {
  if (value.includes("/")) {
    throw new ConfigurationError(`${what} must not contain "/"`, context);
  }
}

/**
 * A map key additionally may not contain `_`: `CamelToSnake` inserts its own
 * separators, and a key that already carries one derives a different string at
 * the type level than at runtime.
 */
export function assertKeyIsSafe(
  value: string,
  what: string,
  context: Record<string, unknown>,
): void {
  if (/[/._]/.test(value)) {
    throw new ConfigurationError(
      `${what} must not contain "/", "." or "_"`,
      context,
    );
  }
}
