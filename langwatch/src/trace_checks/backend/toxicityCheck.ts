import fetch from "node-fetch";
import { env } from "../../env.mjs";
import type { ElasticSearchSpan, Trace } from "../../server/tracer/types";
import type {
  Checks,
  TraceCheckBackendDefinition,
  TraceCheckResult,
} from "../types";
import type { ModerationResult } from "../types";
import { getDebugger } from "../../utils/logger";

const debug = getDebugger("langwatch:trace_checks:toxicityCheck");

const execute = async (
  trace: Trace,
  _spans: ElasticSearchSpan[],
  parameters: Checks["toxicity_check"]["parameters"]
): Promise<TraceCheckResult> => {
  debug("Checking toxicity for trace", trace.id);
  const content = [trace.input.value, trace.output?.value ?? ""].join("\n\n");

  const response = await fetch("https://api.openai.com/v1/moderations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ input: content }),
  });

  const moderationResult = (await response.json()) as ModerationResult;

  const flagged = moderationResult.results.some((result) =>
    Object.entries(result.categories)
      .filter(
        ([category]) =>
          parameters.categories[category as keyof typeof parameters.categories]
      )
      .some(([, value]) => value)
  );
  const highestScore = Math.max(
    ...moderationResult.results.map((result) =>
      Math.max(
        ...Object.entries(result.category_scores)
          .filter(
            ([category]) =>
              parameters.categories[
                category as keyof typeof parameters.categories
              ]
          )
          .map(([, value]) => value)
      )
    )
  );

  return {
    raw_result: moderationResult,
    value: highestScore ?? 0,
    status: flagged ? "failed" : "succeeded",
    costs: [],
  };
};

export const ToxicityCheck: TraceCheckBackendDefinition<"toxicity_check"> = {
  execute,
};
