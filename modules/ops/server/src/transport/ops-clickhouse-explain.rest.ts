/**
 * `POST /api/ops/clickhouse/explain` - the operator-only query planner.
 * Operator-secret, not RBAC: the caller holds this deployment's own key, so
 * the route resolves its own credential and answers its own 401. The
 * application decides everything else, wrapping and auditing included.
 */
import { publicRoute } from "@langwatch/api/access";
import {
  defineRestRouter,
  jsonResponse,
  MANAGEMENT_API_VERSION,
  type RestRawResult,
} from "@langwatch/api/rest";
import { OpsApi, opsExplainRequestSchema, type OpsExplainAnswer } from "@langwatch/ops-contract";

/** Every body this route writes, in the sentences the operator tool parses. */
const OPERATOR_ANSWERS =
  "the operator tool reads a status and a message: 401, 400, 502 and 503 and the EXPLAIN " +
  "rows all keep the exact bodies the agent already parses";

/**
 * `/api/ops/clickhouse/explain`, at the one fixed path the operator tool
 * calls. Literal because there is no dated contract to negotiate.
 */
export const opsClickHouseExplainRest = defineRestRouter(OpsApi)
  .withNamespace("ops-clickhouse-explain")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: true })

  .post("/api/ops/clickhouse/explain", "explainClickHouseQuery")
  // The body is read rather than parsed: a rejected request answers the
  // bespoke `{ message }` the agent already reads, at the field path that
  // failed, which no validation envelope can express.
  .withRawBody("text", { mediaType: "application/json" })
  .withDocs({
    summary: "Explain a ClickHouse query as the read-only operator account",
    description: OPERATOR_ANSWERS,
    requestBody: {
      description: "The inner SELECT to explain, and the plan to ask for.",
      schema: opsExplainRequestSchema,
    },
  })
  .withAccess(
    publicRoute({
      reason:
        "the deployment's own operator secret is compared in constant time by the " +
        "application, which answers the 401; no API credential and no permission opens " +
        "this door, because operator is not an RBAC grain",
    }),
  )
  .withRawResponse({ produces: "application/json" })
  .handle(async ({ app, request, raw }): Promise<RestRawResult> => {
    app.authorizeOperatorSecret({ presented: findPresentedSecret(request) });

    const posted = parsedJson(raw);

    if (posted === null) return jsonResponse({ message: "request body must be JSON" }, 400);

    const parsed = opsExplainRequestSchema.safeParse(posted);

    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path?.length ? `${issue.path.join(".")}: ` : "";

      return jsonResponse({ message: `${path}${issue?.message ?? "invalid body"}` }, 400);
    }

    return answerFor(await app.explainClickHouseQuery(parsed.data));
  })
  .build();

/** The bearer token the caller presented, or nothing. */
function findPresentedSecret(request: Request): string | null {
  const header = request.headers.get("authorization");
  const bearer = header ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;

  return bearer?.[1]?.trim() ?? null;
}

/** The posted document, or null where the body was not JSON. */
function parsedJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** One answer, in the exact body the operator tool already parses. */
function answerFor(answer: OpsExplainAnswer): RestRawResult {
  switch (answer.status) {
    case "ok":
      return jsonResponse({ type: answer.type, rows: answer.rows }, 200);
    case "refused":
      return jsonResponse({ message: answer.reason }, 400);
    case "not_configured_in_production":
      return jsonResponse(
        {
          message:
            "ClickHouse ops user is not configured on this instance (CLICKHOUSE_OPS_URL unset in production).",
        },
        503,
      );
    case "unavailable":
      return jsonResponse({ message: "ClickHouse is not configured on this instance" }, 503);
    case "failed":
      return jsonResponse({ message: "ClickHouse refused the EXPLAIN" }, 502);
  }
}
