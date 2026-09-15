/**
 * CARDS contract: shared schema for CLI, Langy agent, and panel.
 */

export * from "./primitives.ts";
export * from "./cli-json.ts";
export * from "./schemas.ts";
export * from "./derived-safe.ts";
export * from "./registry.ts";
export * from "./digest.ts";
export * from "./tool-result.ts";

/**
 * The handled-error reading is zod-free and also importable on its own
 * (`@langwatch/langy-contract/cards/handled-error`) — the CLI's hot path takes that
 * subpath so that an instrumented command does not drag zod (~28ms) into every
 * invocation. Importing it from here, alongside the schemas, is the right call
 * for the app, which has zod loaded already.
 */
export * from "./handled-error.ts";
