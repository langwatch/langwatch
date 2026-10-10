// Utility type to pull out all values of keys on an object, and only allow types which

import { type AttributeValue } from "@opentelemetry/api";
import { type AnyValue } from "@opentelemetry/api-logs";
import type * as semconvAttributes from "@opentelemetry/semantic-conventions";
import type * as semconvIncubatingAttributes from "@opentelemetry/semantic-conventions/incubating";

import type * as langwatchAttributes from "./attributes";

// are strings, while preserving the auto-completion of the keys.
type OnlyStringValues<T> = {
  [K in keyof T]: T[K] extends string ? T[K] : never;
}[keyof T];

/**
 * All attribute keys usable on a span: OpenTelemetry semantic-convention keys, LangWatch's
 * own attributes, or any custom string.
 */
export type SemConvAttributeKey =
  | OnlyStringValues<typeof semconvIncubatingAttributes>
  | OnlyStringValues<typeof semconvAttributes>
  | OnlyStringValues<typeof langwatchAttributes>
  | (string & {});

/**
 * Span attributes keyed by {@link SemConvAttributeKey}, typed to OpenTelemetry's
 * `AttributeValue`.
 */
export type SemConvAttributes = Partial<Record<SemConvAttributeKey, AttributeValue>>;

/**
 * Log record attributes keyed by {@link SemConvAttributeKey}, typed to OpenTelemetry's
 * `AnyValue`.
 */
export type SemConvLogRecordAttributes = Partial<Record<SemConvAttributeKey, AnyValue>>;
