/**
 * Shared type-level and runtime transforms for deriving handler names from event type strings.
 * Used by both AbstractFoldProjection and AbstractMapProjection.
 */

// ---------------------------------------------------------------------------
// Type-level string transforms
// ---------------------------------------------------------------------------

/** Strip `lw.obs.` or `lw.` prefix from an event type string. */
export type StripPrefix<S extends string> = S extends `lw.obs.${infer R}`
  ? R
  : S extends `lw.${infer R}`
    ? R
    : S;

/** `"foo_bar"` → `"FooBar"` */
export type SnakeToPascal<S extends string> = S extends `${infer H}_${infer T}`
  ? `${Capitalize<H>}${SnakeToPascal<T>}`
  : Capitalize<S>;

/** `"suite_run.item_started"` → `"SuiteRunItemStarted"` */
export type DotSnakeToPascal<S extends string> =
  S extends `${infer H}.${infer T}`
    ? `${SnakeToPascal<H>}${DotSnakeToPascal<T>}`
    : SnakeToPascal<S>;

// ---------------------------------------------------------------------------
// Utility types
// ---------------------------------------------------------------------------

export type UnionToIntersection<U> = (
  U extends unknown ? (k: U) => void : never
) extends (k: infer I) => void
  ? I
  : never;

// ---------------------------------------------------------------------------
// Runtime string transform
// ---------------------------------------------------------------------------

/**
 * Converts a dot.snake_case event type to PascalCase, stripping the lw./lw.obs. prefix.
 * Example: "lw.suite_run.started" → "SuiteRunStarted"
 */
export function eventTypeToPascalSuffix(eventType: string): string {
  const stripped = eventType.startsWith("lw.obs.")
    ? eventType.slice(7)
    : eventType.startsWith("lw.")
      ? eventType.slice(3)
      : eventType;

  return stripped
    .split(".")
    .map((segment) =>
      segment
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(""),
    )
    .join("");
}

/**
 * Converts an event type to a fold handler name: "lw.suite_run.started" → "handleSuiteRunStarted"
 */
export function eventTypeToHandlerName(eventType: string): string {
  return `handle${eventTypeToPascalSuffix(eventType)}`;
}

/**
 * Converts an event type to a map handler name: "lw.suite_run.started" → "mapSuiteRunStarted"
 */
export function eventTypeToMapHandlerName(eventType: string): string {
  return `map${eventTypeToPascalSuffix(eventType)}`;
}
