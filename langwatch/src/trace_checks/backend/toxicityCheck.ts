import fetch from "node-fetch";
import { env } from "../../env.mjs";
import type { ElasticSearchSpan, Trace } from "../../server/tracer/types";
import type { Checks, ModerationCategories, TraceCheckResult } from "../types";
import type { ModerationResult } from "../types";
import { getDebugger } from "../../utils/logger";

const debug = getDebugger("langwatch:trace_checks:toxicityCheck");

export const toxicityCheck = async (
  trace: Trace,
  _spans: ElasticSearchSpan[],
  parameters: Checks["toxicity_check"]["parameters"]
): Promise<TraceCheckResult> => {
  debug("Checking toxicity for trace", trace.id);
  const content = [trace.input.value, trace.output?.value ?? ""].join("\n\n");

  const categoriesMap: Record<ModerationCategories, boolean> = {
    Hate: parameters.categories.hate,
    SelfHarm: parameters.categories.selfHarm,
    Sexual: parameters.categories.sexual,
    Violence: parameters.categories.violence,
  };
  const categories = Object.keys(categoriesMap).filter(
    (key) => categoriesMap[key as keyof typeof categoriesMap]
  ) as ModerationCategories[];

  const response = await fetch(
    `${env.CONTENT_SAFETY_ENDPOINT}/contentsafety/text:analyze?api-version=2023-10-15-preview`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": env.CONTENT_SAFETY_SUBSCRIPTION_KEY ?? "",
      },
      body: JSON.stringify({
        text: content,
        categories,
        outputType: "EightSeverityLevels",
      }),
    }
  );

  const moderationResult = (await response.json()) as ModerationResult;

  const flagged = moderationResult.categoriesAnalysis.some(
    (result) => result.severity > 0
  );
  const highestScore = Math.max(
    ...moderationResult.categoriesAnalysis.map((result) => result.severity)
  );

  return {
    raw_result: moderationResult,
    value: highestScore ?? 0,
    status: flagged ? "failed" : "succeeded",
    costs: [],
  };
};
