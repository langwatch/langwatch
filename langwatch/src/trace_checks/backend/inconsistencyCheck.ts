import fetch from "node-fetch";
import type { Trace } from "../../server/tracer/types";
import type { InconsistencyCheckResult, TraceCheckResult } from "../types";
import { env } from "../../env.mjs";

export const inconsistencyCheck = async (
  trace: Trace
): Promise<TraceCheckResult> => {
  if (!env.LANGWATCH_NLP_SERVICE) {
    throw new Error("LANGWATCH_NLP_SERVICE not set");
  }

  const response = await fetch(
    `${env.LANGWATCH_NLP_SERVICE}/inconsistencies`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: trace.input.value,
        output: trace.output?.value ?? "",
      }),
    }
  );

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
