import type { JsonObjectSchema, JsonSchemaDefinitionEntry } from '../types';
import type { ZodObjectLike } from './zodCompat';
/**
 * The JSON-schema helpers in openai/helpers/zod only emit complete schemas for
 * a subset of Zod constructs. In particular, Zod v4 (and several decorators in v3)
 * omit `type`, `properties`, or `required` metadata, which breaks tool execution
 * when a user relies on automatic schema extraction.
 *
 * This module provides a minimal, type-directed fallback converter that inspects
 * Zod internals and synthesises the missing JSON Schema bits on demand. The
 * converter only covers the constructs we actively depend on (objects, optionals,
 * unions, tuples, records, sets, etc.); anything more exotic simply returns
 * `undefined`, signalling to the caller that it should surface a user error.
 *
 * The implementation is intentionally explicit: helper functions isolate each
 * Zod shape, making the behaviour both testable and easier to trim back if the
 * upstream helper gains first-class support. See zodJsonSchemaCompat.test.ts for
 * the regression cases we guarantee.
 */
type LooseJsonObjectSchema = {
    type: 'object';
    properties: Record<string, JsonSchemaDefinitionEntry>;
    required?: string[];
    additionalProperties?: boolean;
    $schema?: string;
};
export declare function hasJsonSchemaObjectShape(value: unknown): value is LooseJsonObjectSchema;
export declare function zodJsonSchemaCompat(input: ZodObjectLike): JsonObjectSchema<any> | undefined;
export {};
