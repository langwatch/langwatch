/**
 * Operator-secret rather than RBAC: the deployment's operator secret is the
 * bearer the door compares, before the body is capped or parsed.
 */
import { anyAuthenticated } from "@langwatch/api/access";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestProtocolRefusal,
} from "@langwatch/api/rest";
import {
  OpsApi,
  opsExplainRequestSchema,
  opsExplainResultParamsSchema,
} from "@langwatch/ops-contract";
import { resolveRequestBound } from "@langwatch/plans";

import { operatorExplainRefusal } from "#rules/ops-intake-refusal.rules";

/** Every body this route writes, in the sentences the operator tool parses. */
const OPERATOR_ANSWERS =
  "the operator tool reads a status and a message: 401 and 400 keep main's bodies; an accepted " +
  "EXPLAIN answers 202 with a request id the tool polls, as the worker runs it (ADR-202 Decided 14)";

/** The poll's bodies: pending, the rows, a failure with its code, or 404 for an unknown id. */
const OPERATOR_RESULT_ANSWERS =
  "200 with status pending, done (type and rows) or failed (error code and message); 404 when " +
  "the request id is unknown or its result expired; 401 without the operator secret";

const BODY_LIMIT_JSON_BYTES = resolveRequestBound("bodyLimitJsonBytes", "ENTERPRISE");

/** Every refusal, the secret's included, in the `{ message }` the tool reads. */
const operatorRefusal: RestProtocolRefusal = ({ failure, response }) => {
  const { status, body } = operatorExplainRefusal(failure);

  return response.write({ status, mediaType: "application/json", body: JSON.stringify(body) });
};

/**
 * `/api/ops/clickhouse/explain`, at the one fixed path the operator tool
 * calls. Literal because there is no dated contract to negotiate.
 */
export const opsClickHouseExplainRest = defineRestRouter(OpsApi)
  .withNamespace("ops-clickhouse-explain")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: true })

  .post("/api/ops/clickhouse/explain", "explainClickHouseQuery")
  .keepsRecords()
  .withoutAudit("read sent as a POST")
  .withInput(opsExplainRequestSchema)
  .withDocs({
    summary: "Explain a ClickHouse query as the read-only operator account",
    description: OPERATOR_ANSWERS,
  })
  .withCredential("internal_secret")
  .withAccess(
    anyAuthenticated({
      reason:
        "the deployment's operator secret is the bearer this door compares in constant time; " +
        "no permission is asked, because operator is not an RBAC grain",
    }),
  )
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withResponse("protocol", {
    produces: "application/json",
    because: OPERATOR_ANSWERS,
    refusal: operatorRefusal,
  })
  .handle(async ({ app, input, response }) => {
    const answer = await app.explainClickHouseRequest({ request: input });

    return response.write({
      status: answer.status,
      mediaType: "application/json",
      body: JSON.stringify(answer.body),
    });
  })

  .get("/api/ops/clickhouse/explain/:requestId", "getClickHouseExplainResult")
  .withParams(opsExplainResultParamsSchema)
  .withDocs({
    summary: "Read one accepted ClickHouse EXPLAIN's answer by its request id",
    description: OPERATOR_RESULT_ANSWERS,
  })
  .withCredential("internal_secret")
  .withAccess(
    anyAuthenticated({
      reason:
        "the deployment's operator secret is the bearer this door compares in constant time, as " +
        "on the EXPLAIN it polls; operator is not an RBAC grain",
    }),
  )
  .withResponse("protocol", {
    produces: "application/json",
    because: OPERATOR_RESULT_ANSWERS,
    refusal: operatorRefusal,
  })
  .handle(async ({ app, input, response }) => {
    const answer = await app.explainClickHouseResultRequest({ requestId: input.requestId });

    return response.write({
      status: answer.status,
      mediaType: "application/json",
      body: JSON.stringify(answer.body),
    });
  })
  .build();
