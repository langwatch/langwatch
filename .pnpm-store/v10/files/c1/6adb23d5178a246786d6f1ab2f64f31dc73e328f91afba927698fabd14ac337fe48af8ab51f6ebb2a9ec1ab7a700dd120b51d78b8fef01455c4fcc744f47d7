import type { JSONSchema, JSONSchemaDefinition } from "./jsonschema.mjs";
type JSONSchemaChildVisitor = (schema: unknown, path: string[], keyword: string) => void;
/**
 * Visits only values carried by JSON Schema keywords that contain schemas.
 * Literal payloads such as enum, const, and default deliberately do not
 * participate.
 */
export declare function forEachJSONSchemaChild(schema: JSONSchema | Record<string, unknown>, path: string[], visit: JSONSchemaChildVisitor): void;
export declare function toStrictJsonSchema(schema: JSONSchema): JSONSchema;
export declare function resolveLocalRef(root: JSONSchema, ref: string): JSONSchemaDefinition | undefined;
export declare function hasOnlyRefAndAnnotations(schema: JSONSchema): boolean;
export declare function assertNoNestedSchemaIds(schema: JSONSchema): void;
/**
 * Standard Schema normalization moves representable oneOf branches to anyOf.
 * Rewrite only pointers that traverse an actual oneOf schema array while the
 * original tree is still intact, preserving escaped tokens for every other
 * path segment.
 */
export declare function rewriteLocalRefsIntoMovedOneOfBranches(root: JSONSchema): void;
/**
 * Standard Schema needs to prove oneOf branches exclusive before it rewrites
 * them to anyOf. Inspect a cloned branch through the same conservative object
 * allOf merger without mutating the caller's schema or broadening failures.
 */
export declare function normalizeObjectAllOfForExclusivity(schema: JSONSchema, root: JSONSchema): JSONSchema | undefined;
export {};
//# sourceMappingURL=transform.d.mts.map