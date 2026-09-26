/**
 * Operator-secret rather than RBAC: this route resolves the deployment key and
 * its own 401; the application retains wrapping and auditing.
 */
import { publicRoute } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import { OpsApi, opsExplainRequestSchema } from "@langwatch/ops-contract";
import { resolveRequestBound } from "@langwatch/plans";
import { HTTPException } from "hono/http-exception";

/** Every body this route writes, in the sentences the operator tool parses. */
const OPERATOR_ANSWERS =
  "the operator tool reads a status and a message: 401, 400, 502 and 503 and the EXPLAIN " +
  "rows all keep the exact bodies the agent already parses";

/** The 413 a body past its cap earns, in the plain sentence it has always been. */
const payloadTooLarge = (): Error =>
  new HTTPException(413, { res: new Response("Payload Too Large", { status: 413 }) });

const BODY_LIMIT_JSON_BYTES = resolveRequestBound("bodyLimitJsonBytes", "ENTERPRISE");

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
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES, onExceeded: payloadTooLarge })
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
  .withResponse("protocol", { produces: "application/json", because: OPERATOR_ANSWERS })
  .handle(async ({ app, request, raw, response }) => {
    const answer = await app.explainClickHouseRequest({
      body: raw,
      authorization: request.headers.get("authorization"),
    });

    return response.write({
      status: answer.status,
      mediaType: "application/json",
      body: JSON.stringify(answer.body),
    });
  })
  .build();
