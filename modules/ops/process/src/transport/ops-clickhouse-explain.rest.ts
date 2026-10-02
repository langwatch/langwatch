/**
 * Operator-secret rather than RBAC: the secret is compared in constant time by
 * the application, as an early fact, before the body is capped or parsed.
 */
import { publicRoute } from "@langwatch/api/access";
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestProtocolRefusal,
} from "@langwatch/api/rest";
import { OpsApi, opsExplainRequestSchema } from "@langwatch/ops-contract";
import { resolveRequestBound } from "@langwatch/plans";
import { z } from "zod";

import { operatorExplainRefusal } from "#rules/ops-intake-refusal.rules";

/** Every body this route writes, in the sentences the operator tool parses. */
const OPERATOR_ANSWERS =
  "the operator tool reads a status and a message: 401, 400, 502 and 503 and the EXPLAIN " +
  "rows all keep the exact bodies the agent already parses";

const BODY_LIMIT_JSON_BYTES = resolveRequestBound("bodyLimitJsonBytes", "ENTERPRISE");

/**
 * The operator secret, checked off the Authorization header alone. A public
 * route's sourceless fact resolves before the body, so a caller without the
 * secret is refused 401 ahead of any 400, 413 or 422.
 */
export const operatorSecret = defineRestMiddleware("operatorSecret", z.null());

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
  .withInput(opsExplainRequestSchema)
  .withDocs({
    summary: "Explain a ClickHouse query as the read-only operator account",
    description: OPERATOR_ANSWERS,
  })
  .withAccess(
    publicRoute({
      reason:
        "the deployment's own operator secret is compared in constant time by the " +
        "application, which answers the 401; no API credential and no permission opens " +
        "this door, because operator is not an RBAC grain",
    }),
  )
  .withMiddleware(operatorSecret)
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
  .build();
