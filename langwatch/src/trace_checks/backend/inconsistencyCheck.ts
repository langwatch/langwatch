import fetch from "node-fetch";
import type { Trace } from "../../server/tracer/types";
import type {
  InconsistencyCheckResult,
  TraceCheckBackendDefinition,
  TraceCheckResult,
} from "../types";
import { env } from "../../env.mjs";

const execute = async (trace: Trace): Promise<TraceCheckResult> => {
  if (!env.INCONSISTENCY_CHECKING_SERVICE_URL) {
    throw new Error("INCONSISTENCY_CHECKING_SERVICE_URL not set");
  }

  const response = await fetch(env.INCONSISTENCY_CHECKING_SERVICE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: trace.input.value,
      output: trace.output?.value ?? "",
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Inconsistency check API returned an error: ${response.statusText}`
    );
  }

  const result = (await response.json()) as InconsistencyCheckResult;
  const inconsistencies = result.sentences;

  return {
    raw_result: result,
    value: inconsistencies.length,
    status: inconsistencies.length > 0 ? "failed" : "succeeded",
    costs: [],
  };
};

export const InconsistencyCheck: TraceCheckBackendDefinition<"inconsistency_check"> =
  {
    execute,
  };
