/**
 * `@langwatch/cli-cards` — the contract between the LangWatch CLI and the Langy
 * panel.
 *
 * Langy reaches LangWatch by running the CLI in a shell, so everything the panel
 * knows about a result it learns from a JSON document on stdout. Until now both
 * ends guessed at that document's shape independently: the CLI knew what it
 * printed, the panel duck-typed it back. This package is the shape itself, stated
 * once and imported by both.
 *
 * Four things live here, and nothing else:
 *   - the CARD schemas: what a result looks like, per card the panel can draw;
 *   - the REGISTRY: which card reads which `langwatch <resource> <verb>`;
 *   - the DIGEST: the compact reference a result is remembered by (ids, query,
 *     counts), extracted server-side so cards hydrate fresh data instead of
 *     re-reading stale stdout;
 *   - the DOMAIN ERROR: how a failure is structured, so a "dataset not found" can
 *     stay a fact the UI can act on instead of decaying into a sentence.
 *
 * Consumed by `typescript-sdk` (the CLI, zod 4) and by the app (zod 3.25) — via
 * the `zod/v4` subpath, which is the one schema runtime both ship. See the note
 * in `primitives.ts` before changing that import.
 */

export {
  collectionSchema,
  hitsPaginationSchema,
  idSchema,
  pagePaginationSchema,
  paginationSchema,
  resolveTotal,
  rowOrTruncationMarker,
  textValueSchema,
  type Pagination,
} from "./primitives.js";

export { parseCliJson } from "./cliJson.js";

export {
  cliToolResultSchema,
  cliToolResultPayload,
  parseCliToolResult,
  toCliTextResult,
  toCliToolResult,
  type CliToolResult,
} from "./tool-result.js";

export {
  cliResultDigestSchema,
  DIGEST_STRATEGIES,
  extractDigest,
  MAX_DIGEST_IDS,
  type CliResultDigest,
  type DigestStrategy,
} from "./digest.js";

export {
  CARD_KINDS,
  SCHEMA_BY_CARD_KIND,
  datasetCardSchema,
  evalRunCardSchema,
  metricsCardSchema,
  promptDiffCardSchema,
  resourceCardSchema,
  scenarioCardSchema,
  traceCardSchema,
  traceIdOf,
  traceSummarySchema,
  tracesCardSchema,
  type CardKind,
  type TraceSummary,
} from "./cards.js";

export {
  CARDS_BY_RESOURCE,
  CLI_COLLECTION_VERBS,
  CLI_SUBRESOURCE_VERBS,
  asJsonDocument,
  cardKindFor,
  cardSchemaFor,
  cliVerbTone,
  parseCliResult,
  type CliVerbTone,
  type ParsedCliResult,
  type ResourceRefHints,
} from "./registry.js";

/**
 * The handled-error reading is zod-free and also importable on its own
 * (`@langwatch/cli-cards/handled-error`) — the CLI's hot path takes that subpath so
 * that an instrumented command does not drag zod (~28ms) into every invocation.
 * Importing it from here, alongside the schemas, is the right call for the app,
 * which has zod loaded already.
 */
export {
  handledErrorFromThrown,
  parseHandledError,
  readCliErrorDocument,
  toCliErrorDocument,
  type CliHandledError,
  type CliHandledErrorReason,
  type CliErrorDocument,
} from "./handled-error.js";
