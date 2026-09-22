/**
 * LangWatchQL over REST at `/api/v1/query`. Version-first, unlike the families
 * that predate it: a consumer holding a base URL learns one rule for `v1`.
 * @see modules/analytics/specs — lwql-api
 */
import {
  langWatchQLProtectionsSchema,
  langWatchQLReachSchema,
  lwqlResultSchema,
  lwqlSchemaSchema,
  lwqlStatementSchema,
  queryReferenceSchema,
  type AnalyticsApi,
  type LangWatchQLCaller,
} from "@langwatch/analytics-contract";
import { anyAuthenticated } from "@langwatch/api/access";
import {
  canonicalBaseResponses,
  canonicalUnprocessableResponses,
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  resolver,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/kernel/module-api";

import { LWQL_CLEAN_DIAGNOSTICS_MEANING } from "../rules/langwatch-ql-diagnostics-shape.rules.ts";

/**
 * What the query door reaches — project identity is the process's; the
 * tenant capability is hashed from a secret the request never carries.
 * Typed straight off {@link AnalyticsApi}, so it can't name a spelling the app doesn't implement.
 */
export interface AnalyticsQueryApi extends Pick<
  AnalyticsApi,
  "describeLangWatchQLSchema" | "describeQueryReference" | "executeLangWatchQL"
> {
  /**
   * The project identity one execution runs under, for a CREDENTIAL rather
   * than a member — this door has no session, so caller protections arrive
   * as a fact. The LangWatchQL secret must never leave the handler.
   */
  resolveApiKeyRunCaller(input: Readonly<{ projectId: string }>): Promise<LangWatchQLCaller>;
}

export const AnalyticsQueryApi = moduleApi<AnalyticsQueryApi>()("analytics");

/**
 * What this credential may see of its project's content. A fact rather than an
 * operation: the answer is the KEY's own cut, and the credential is the door's
 * to read, never the handler's.
 */
export const langWatchQLCallerProtections = defineRestMiddleware(
  "langWatchQLCallerProtections",
  langWatchQLProtectionsSchema,
);

/**
 * How far this credential reaches, resolved by the door: whether the key may
 * run LangWatchQL decides which half of the reference is published, and the
 * answer is the KEY's own ceiling rather than anything the request states.
 */
export const langWatchQLCallerReach = defineRestMiddleware(
  "langWatchQLCallerReach",
  langWatchQLReachSchema,
);

const QUERY_TAGS = ["Query"];

/** Why the reference door names no permission of its own. */
const REFERENCE_IS_THE_VOCABULARY_OF_BOTH_LANGUAGES =
  "Any credential for the project may read the reference: half of what it describes is the traces family's own filter vocabulary, so a key without analytics:view is answered with the LangWatchQL half withheld rather than refused.";

const RUN_DESCRIPTION =
  "Executes one read-only LangWatchQL SELECT over the analytics datasets and returns typed columns, rows, execution statistics, truncation state and diagnostics. The query runs as a restricted database identity scoped to the authenticated project.\n\n" +
  `Diagnostics are advisory and never reject a query. ${LWQL_CLEAN_DIAGNOSTICS_MEANING}\n\n` +
  "The project is taken from the credential — no project id appears anywhere in the path or the body, and none can be sent to select another one.\n\n" +
  "Failures answer with their real HTTP status (a refused query is 403, not 200) and this API's canonical error envelope — the same `code` and `meta` every other REST family publishes.";

const SCHEMA_DESCRIPTION =
  "Lists the LangWatchQL analytics datasets this key may query, with each column's type, description, the permissions that unlock it, and whether this caller holds them — plus each dataset's grain, join keys, partition-pruning time column, freshness and a runnable example query.\n\n" +
  "Scoped to the credential's own project and its permissions: a column this key cannot read is listed with `available: false` rather than hidden, so a caller can see what a wider key would unlock.";

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

  /** `POST /api/v1/query` — execute one statement. The body IS the query. */
  .post("/", "postApiV1Query")
  .withInput(lwqlStatementSchema)
  .withPermission("analytics:view")
  .withMiddleware(langWatchQLCallerProtections)
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
          "The query ran. Columns, rows, execution statistics, truncation state and diagnostics, scoped to the caller's project.",
        content: { "application/json": { schema: resolver(lwqlResultSchema) } },
      },
    },
  })
  .handle(async ({ app, input, scope }, protections) => {
    const { sql, parameters, timeWindow, granularitySeconds } = input;

    return app.executeLangWatchQL({
      project: await app.resolveApiKeyRunCaller({ projectId: scope.id }),
      protections,
      sql,
      ...(parameters ? { parameters } : {}),
      ...(timeWindow ? { timeWindow } : {}),
      ...(granularitySeconds === undefined ? {} : { granularitySeconds }),
    });
  })

  /**
   * `GET /api/v1/query/schema` — describe what may be queried. A GET, because
   * it reads a catalog and takes no arguments: the credential is the whole of
   * its input.
   */
  .get("/schema", "getApiV1QuerySchema")
  .withPermission("analytics:view")
  .withMiddleware(langWatchQLCallerProtections)
  .withOutput(lwqlSchemaSchema)
  .withDocs({
    summary: "Discover the queryable LangWatchQL schema",
    description: SCHEMA_DESCRIPTION,
    tags: QUERY_TAGS,
    responses: {
      ...canonicalBaseResponses,
      200: {
        description:
          "The datasets and columns this key may query, with the permissions that unlock each one.",
        content: { "application/json": { schema: resolver(lwqlSchemaSchema) } },
      },
    },
  })
  .handle(({ app, scope }, protections) =>
    app.describeLangWatchQLSchema({ projectId: scope.id, protections }),
  )

  /**
   * `GET /api/v1/query/reference` — describe both query languages. A sibling of
   * `/schema` rather than a replacement: this is the document a caller reads
   * when it does not yet know WHICH language answers its question.
   */
  .get("/reference", "getApiV1QueryReference")
  .withAccess(anyAuthenticated({ reason: REFERENCE_IS_THE_VOCABULARY_OF_BOTH_LANGUAGES }))
  .withMiddleware(langWatchQLCallerProtections, langWatchQLCallerReach)
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
  .handle(({ app, scope }, protections, reach) =>
    app.describeQueryReference({
      projectId: scope.id,
      protections,
      canRunLangWatchQL: reach.canRunLangWatchQL,
    }),
  )
  .build();
