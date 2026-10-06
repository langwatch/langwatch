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
import { OpsApi, opsExplainRequestSchema } from "@langwatch/ops-contract";
import { resolveRequestBound } from "@langwatch/plans";

import { operatorExplainRefusal } from "#rules/ops-intake-refusal.rules";

/** Every body this route writes, in the sentences the operator tool parses. */
const OPERATOR_ANSWERS =
  "the operator tool reads a status and a message: 401, 400, 502 and 503 and the EXPLAIN " +
  "rows all keep the exact bodies the agent already parses";

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
  .build();
