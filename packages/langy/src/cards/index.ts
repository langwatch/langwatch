/**
 * CARDS — the contract between the LangWatch CLI, the Langy agent and the
 * Langy panel.
 *
 * Langy reaches LangWatch by running the CLI in a shell, so everything the
 * panel knows about a result it learns from a JSON document on stdout. Both
 * ends used to guess at that document's shape independently: the CLI knew what
 * it printed, the panel duck-typed it back. This directory is the shape
 * itself, stated once and imported by both.
 *
 * What lives here, and nothing else:
 *   - the CARD SCHEMAS (`schemas.ts`): every kind of card the panel can draw,
 *     and the shapes they are built from — ONE vocabulary, whichever channel
 *     wrote the card;
 *   - the DERIVED-SAFE ALLOWLIST (`derived-safe.ts`): the closed subset of
 *     those kinds Langy may write for itself, and the strict schemas an
 *     inline ```langy-card fence is validated against (ADR-060);
 *   - the REGISTRY (`registry.ts`): which card reads which
 *     `langwatch <resource> <verb>`;
 *   - the DIGEST (`digest.ts`): the compact reference a result is remembered
 *     by (ids, query, counts), extracted server-side so cards hydrate fresh
 *     data instead of re-reading stale stdout;
 *   - the DOMAIN ERROR (`handled-error.ts`): how a failure is structured, so a
 *     "dataset not found" stays a fact the UI can act on instead of decaying
 *     into a sentence.
 *
 * Consumed by `typescript-sdk` (the CLI, zod 4) and by the app (zod 3.25) —
 * via the `zod/v4` subpath, which is the one schema runtime both ship. See the
 * note in `primitives.ts` before changing that import.
 *
 * The CLI imports this directory through `@langwatch/langy/cards` rather than
 * the package root: the root barrel also carries the event-sourcing contracts,
 * which the CLI has no use for and should not pay to load.
 */

export * from "./primitives.js";
export * from "./cliJson.js";
export * from "./schemas.js";
export * from "./derived-safe.js";
export * from "./registry.js";
export * from "./digest.js";
export * from "./tool-result.js";

/**
 * The handled-error reading is zod-free and also importable on its own
 * (`@langwatch/langy/cards/handled-error`) — the CLI's hot path takes that
 * subpath so that an instrumented command does not drag zod (~28ms) into every
 * invocation. Importing it from here, alongside the schemas, is the right call
 * for the app, which has zod loaded already.
 */
export * from "./handled-error.js";
