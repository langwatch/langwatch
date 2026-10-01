/**
 * LangWatchQL over REST at `/api/v1/query`. Version-first, unlike the families
 * that predate it: a consumer holding a base URL learns one rule for `v1`.
 * @see modules/analytics/specs — lwql-api
 */
import {
  langWatchQLKeyReach,
  lwqlResultSchema,
  lwqlSchemaSchema,
  lwqlStatementSchema,
  queryReferenceSchema,
  type LangWatchQLKeyReach,
  type LangWatchQLQueryResult,
  type LangWatchQLSchema,
  type LangWatchQLStatementRequest,
  type QueryReference,
} from "@langwatch/analytics-contract";
import {
  LWQL_MAX_RESULT_BYTES,
  LWQL_MAX_RESULT_ROWS,
} from "@langwatch/analytics-contract/langwatch-ql-limits";
import { anyAuthenticated } from "@langwatch/api/access";
import {
  canonicalBaseResponses,
  canonicalUnprocessableResponses,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  resolver,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/kernel/module-api";

import { LWQL_CLEAN_DIAGNOSTICS_MEANING } from "../rules/langwatch-ql-diagnostics-shape.rules.ts";

/**
 * What the query door reaches: each operation fans the authenticated key out to the projects it
 * may read, so the handler hands over the key and never a project it picked.
 */
export interface AnalyticsQueryApi {
  runLangWatchQLForKey(
    input: Readonly<{ reach: LangWatchQLKeyReach } & LangWatchQLStatementRequest>,
  ): Promise<LangWatchQLQueryResult>;
  describeLangWatchQLSchemaForKey(
    input: Readonly<{ reach: LangWatchQLKeyReach }>,
  ): Promise<LangWatchQLSchema>;
  describeQueryReferenceForKey(
    input: Readonly<{ reach: LangWatchQLKeyReach }>,
  ): Promise<QueryReference>;
}

export const AnalyticsQueryApi = moduleApi<AnalyticsQueryApi>()("analytics");

const QUERY_TAGS = ["Query"];

/** Why the reference door names no permission of its own. */
const REFERENCE_IS_THE_VOCABULARY_OF_BOTH_LANGUAGES =
  "Any credential for the project may read the reference: half of what it describes is the traces family's own filter vocabulary, so a key without analytics:view is answered with the LangWatchQL half withheld rather than refused.";

/** Why the run and schema doors name no route permission. */
const THE_KEY_FANS_OUT =
  "Any API key reaches the projects it holds analytics:view on: the fan-out and the row policy enforce the scope, and a key that reads no project is a valid empty scope rather than a refusal.";

/**
 * How a caller reaches the projects it queries, shared by both doors so they can't describe the
 * rule differently.
 */
const HEADER_RULE =
  "Any LangWatch API key — project, organization or personal — reaches every project it can read `analytics:view` on: an organization or personal key spans its projects, a project key its one. Rows from more than one project come back flagged with the `MULTI_PROJECT_RESULT` diagnostic — to read a single project, filter inside the statement with `WHERE TenantId = '<project id>'`.";

/** The result bounds, read off the enforced caps so this copy and the enforcement cannot drift. */
const RESULT_CEILINGS = `A statement that names no \`LIMIT\` is capped at ${LWQL_MAX_RESULT_ROWS.toLocaleString("en-US")} rows: that \`LIMIT\` is appended before the query runs. A statement whose own \`LIMIT\` asks for more is refused with \`LIMIT_TOO_HIGH\` — lower it and page the rest with \`LIMIT\`/\`OFFSET\` and an \`ORDER BY\`. When using \`UNION\`, every top-level branch must carry its own \`LIMIT\` clause of ${LWQL_MAX_RESULT_ROWS.toLocaleString("en-US")} rows or fewer, or the query is refused with \`LIMIT_REQUIRED_PER_BRANCH\`. A result whose body exceeds about ${LWQL_MAX_RESULT_BYTES.toLocaleString("en-US")} bytes is refused outright with \`lwql_result_too_large\`, never cut — select fewer columns or a smaller \`LIMIT\`.`;

const RUN_DESCRIPTION =
  "Executes one read-only LangWatchQL SELECT over the analytics views and returns typed columns, rows, execution statistics and diagnostics. The query runs as a restricted database identity scoped to the projects this key can read.\n\n" +
  `Diagnostics are advisory and never reject a query. ${LWQL_CLEAN_DIAGNOSTICS_MEANING}\n\n` +
  "A projection may call the app functions the schema endpoint lists (`conversation`, `llm_readable_trace`, `llm_messages`, and so on). Those are computed by the application after the query, so they are allowed only as aliased entries in the top-level SELECT list; a call in WHERE, GROUP BY, ORDER BY, a join, a subquery or a nested expression is refused, and a UNION disqualifies both of its branches even where each reads as a top-level projection. A projection may also call the eval functions, which judge a text with a model and are charged for; their key is the text itself. A run that would need more distinct conversations, traces, spans or texts than the published cap answers 422 rather than a partial result, and a run whose texts would exceed the per-query token budget answers 422 before anything is sent.\n\n" +
  `${HEADER_RULE}\n\n` +
  `${RESULT_CEILINGS}\n\n` +
  "Failures answer with their real HTTP status (a refused query is 403, not 200) and this API's canonical error envelope — the same `code` and `meta` every other REST family publishes.";

const SCHEMA_DESCRIPTION =
  "Lists the LangWatchQL analytics views this key may query, with each column's type, description, the permissions that unlock it, and whether this caller holds them — plus each view's grain, join keys, partition-pruning time column, freshness and a runnable example query. It also lists, under `functions`, every function name a query may call.\n\n" +
  "Under `appFunctions` it lists the app functions a projection may call, each with its signature, the type and encoding of the value it returns, how many distinct keys one run may read, and the permissions it needs.\n\n" +
  "Scoped to the projects the credential can read and their permissions: a column or app function this key cannot read in every one of them is listed with `available: false` rather than hidden, so a caller can see what a wider key would unlock.\n\n" +
  HEADER_RULE;

const REFERENCE_DESCRIPTION =
  "Describes both query languages in one payload: LangWatchQL (SQL over the analytics datasets) with its schema, limits and endpoints, and the trace filter (a Lucene-flavoured string over the trace list) with its syntax, its fields and their static value vocabularies, and the open-ended attribute namespaces.\n\n" +
  "It also carries worked examples in both languages and a table saying which language answers which kind of question. Every example is checked against the real validator before it ships, so a published example parses; whether THIS key can run one is its own `available` flag.\n\n" +
  "Pure: it reads the catalogues and this key's own permissions, never the project's traces, so it answers from memory rather than from the database.\n\n" +
  "The document is shaped by the calling credential — `available`, the embedded schema and the gated columns all differ between keys — so never cache it beyond the key that asked for it. Ask again rather than storing it.\n\n" +
  "The values a field actually holds change under you and are a separate call — `GET /api/traces/facets`.\n\n" +
  "An example this key cannot run is listed with `available: false` and keeps its `requires.gates`, so a caller can see which permission it needs.\n\n" +
  "Any credential for the project may read it. The trace filter half is the traces family's vocabulary, so a key scoped to `traces:view` alone is answered rather than refused; for that key the LangWatchQL half arrives with `lwql.enabled: false` and an empty schema. `GET /api/v1/query/schema` is stricter and refuses that key outright, which is why this document withholds the catalogue rather than repeating it.";

/**
 * The type is written out rather than inferred so the declaration emit
 * stays portable.
 */
export const queryRest: Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<AnalyticsQueryApi>;
}> = defineRestRouter(AnalyticsQueryApi)
  .withNamespace("query")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("v1-only")
  .withCredential("apiKey")

  /** `POST /api/v1/query` — execute one statement. The body IS the query. */
  .post("/", "postApiV1Query")
  .withInput(lwqlStatementSchema)
  .withAccess(anyAuthenticated({ reason: THE_KEY_FANS_OUT }))
  .withMiddleware(langWatchQLKeyReach)
  .withOutput(lwqlResultSchema)
  .withDocs({
    summary: "Run a LangWatchQL query",
    description: RUN_DESCRIPTION,
    tags: QUERY_TAGS,
    responses: {
      ...canonicalBaseResponses,
      // A scan-ceiling refusal: the statement is well formed, the volume it
      // would read is not allowed. QueryScanLimitExceededError carries 422.
      ...canonicalUnprocessableResponses,
      200: {
        description:
          "The query ran. Columns, rows, execution statistics and diagnostics, scoped to the projects the key can read.",
        content: { "application/json": { schema: resolver(lwqlResultSchema) } },
      },
    },
  })
  .handle(({ app, input }, reach) => app.runLangWatchQLForKey({ reach, ...input }))

  /**
   * `GET /api/v1/query/schema` — describe what may be queried. A GET, because
   * it reads a catalog and takes no arguments: the credential is the whole of
   * its input.
   */
  .get("/schema", "getApiV1QuerySchema")
  .withAccess(anyAuthenticated({ reason: THE_KEY_FANS_OUT }))
  .withMiddleware(langWatchQLKeyReach)
  .withOutput(lwqlSchemaSchema)
  .withDocs({
    summary: "Discover the queryable LangWatchQL schema",
    description: SCHEMA_DESCRIPTION,
    tags: QUERY_TAGS,
    responses: {
      ...canonicalBaseResponses,
      200: {
        description:
          "The views and columns this key may query, with the permissions that unlock each one.",
        content: { "application/json": { schema: resolver(lwqlSchemaSchema) } },
      },
    },
  })
  .handle(({ app }, reach) => app.describeLangWatchQLSchemaForKey({ reach }))

  /**
   * `GET /api/v1/query/reference` — describe both query languages. A sibling of
   * `/schema` rather than a replacement: this is the document a caller reads
   * when it does not yet know WHICH language answers its question.
   */
  .get("/reference", "getApiV1QueryReference")
  .withAccess(anyAuthenticated({ reason: REFERENCE_IS_THE_VOCABULARY_OF_BOTH_LANGUAGES }))
  .withMiddleware(langWatchQLKeyReach)
  .withOutput(queryReferenceSchema)
  .withDocs({
    summary: "Discover both query languages",
    description: REFERENCE_DESCRIPTION,
    tags: QUERY_TAGS,
    responses: {
      ...canonicalBaseResponses,
      200: {
        description:
          "The LangWatchQL schema and limits, the trace filter's syntax and fields, worked examples in both languages, and which language answers which kind of question.",
        content: { "application/json": { schema: resolver(queryReferenceSchema) } },
      },
    },
  })
  .handle(({ app }, reach) => app.describeQueryReferenceForKey({ reach }))
  .build();
