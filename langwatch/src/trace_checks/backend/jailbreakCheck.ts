import fetch from "node-fetch";
import { env } from "../../env.mjs";
import type { Trace } from "../../server/tracer/types";
import type { JailbreakAnalysisResult, TraceCheckResult } from "../types";

const execute = async (trace: Trace): Promise<TraceCheckResult> => {
  const content = trace.input.value;

  const response = await fetch(
    `${env.CONTENT_SAFETY_ENDPOINT}/contentsafety/text:detectJailbreak?api-version=2023-10-15-preview`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": env.CONTENT_SAFETY_SUBSCRIPTION_KEY ?? "",
      },
      body: JSON.stringify({ text: content }),
    }
  );

  const result = (await response.json()) as JailbreakAnalysisResult;
  const detected = result.jailbreakAnalysis.detected;

  return {
    raw_result: result,
    value: detected ? 1 : 0,
    status: detected ? "failed" : "succeeded",
    costs: [],
  };
};

export const JailbreakCheck = {
  execute,
};
