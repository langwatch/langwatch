import type { HttpTestErrorExplanation } from "@langwatch/agent-contract/http-test";
import { explainSerializedError } from "@langwatch/handled-error/presentation";
import { nodeErrorToDomainError } from "@langwatch/workflow-contract";

/**
 * A failure the engine named reads in the registry's words, as on main's test panel
 * ("That address isn't allowed", not `ssrf_blocked`). The raw message is not shown.
 */
export const explainTestError: HttpTestErrorExplanation = ({ errorCode, status }) => {
  const coded = errorCode
    ? explainSerializedError(
        nodeErrorToDomainError({ errorType: errorCode, upstreamStatus: status }),
      )
    : null;
  if (!coded?.isRegistered) return { title: "The test request failed" };
  return { title: coded.title, ...(coded.description ? { description: coded.description } : {}) };
};
