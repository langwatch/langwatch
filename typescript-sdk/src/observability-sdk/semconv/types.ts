
// Utility type to pull out all values of keys on an object, and only allow types which

import { AttributeValue } from "@opentelemetry/api";
import { AnyValue } from "@opentelemetry/api-logs";
import * as semconvAttributes from "@opentelemetry/semantic-conventions/incubating";
import * as langwatchAttributes from "./attributes";

// are strings, while preserving the auto-completion of the keys.
type OnlyStringValues<T> = {
  [K in keyof T]: T[K] extends string ? T[K] : never;
}[keyof T];

/**
 * Union type representing all possible attribute keys that can be used in spans.
 *
 * This includes:
 * - Standard OpenTelemetry semantic convention attributes
 * - LangWatch-specific attributes
 * - Custom string attributes
 *
 * @example
 * ```typescript
 * const attributes: SemconvAttributes = {
 *   "http.method": "GET",
 *   "http.url": "https://api.example.com",
 *   "langwatch.span.type": "llm",
 *   "custom.attribute": "value"
 * };
 * ```
 */
export type SemConvAttributeKey =
  | OnlyStringValues<typeof semconvAttributes>
  | OnlyStringValues<typeof langwatchAttributes>
  | (string & {});

/**
 * Record type representing span attributes with semantic convention keys.
 *
 * This type ensures type safety when setting attributes on spans while
 * allowing both standard OpenTelemetry semantic conventions and custom attributes.
 *
 * @example
 * ```typescript
 * const spanAttributes: SemConvAttributes = {
 *   "service.name": "my-service",
 *   "service.version": "1.0.0",
 *   "langwatch.span.type": "llm",
 *   "custom.user.id": "user123"
 * };
 * ```
 */
export type SemConvAttributes = Partial<Record<SemConvAttributeKey, AttributeValue>>;

/**
 * Record type representing log record attributes with semantic convention keys.
 *
 * This type ensures type safety when setting attributes on log records while
 * allowing both standard OpenTelemetry semantic conventions and custom attributes.
 *
 * @example
 * ```typescript
 * const logRecordAttributes: SemConvLogRecordAttributes = {
 *   "log.level": "INFO",
 *   "log.source": "my-service",
 *   "log.category": "test",
 *   "user.id": "12345",
 *   "string.attr": "string value",
 *   "number.attr": 42,
 *   "boolean.attr": true,
 *   "array.attr": ["item1", "item2", "item3"],
 *   "object.attr": { key1: "value1", key2: "value2" },
 *   "null.attr": null,
 *   "undefined.attr": undefined
 * };
 * ```
 */
export type SemConvLogRecordAttributes = Partial<Record<SemConvAttributeKey, AnyValue>>;
