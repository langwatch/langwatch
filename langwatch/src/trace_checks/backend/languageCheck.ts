import fetch from "node-fetch";
import type { ElasticSearchSpan, Trace } from "../../server/tracer/types";
import type {
  Checks,
  LanguageCheckApiResponse,
  TraceCheckResult,
} from "../types";
import { env } from "../../env.mjs";

export const languageCheck = async (
  trace: Trace,
  _spans: ElasticSearchSpan[],
  parameters: Checks["language_check"]["parameters"]
): Promise<TraceCheckResult> => {
  const response = await fetch(`${env.LANGWATCH_GUARDRAILS_SERVICE}/language`, {
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
      `Language check API returned an error: ${response.statusText}`
    );
  }

  const result = (await response.json()) as LanguageCheckApiResponse;
  const { languages } = result;
  let match = true;

  if (
    parameters.checkFor === "input_matches_output" &&
    languages.input &&
    languages.output
  ) {
    match =
      languages.match &&
      (parameters.expectedLanguage === "any" ||
        languages.input.includes(parameters.expectedLanguage));
  } else if (
    (parameters.checkFor === "input_language" ||
      parameters.checkFor === "input_matches_output") &&
    languages.input
  ) {
    match = languages.input.includes(parameters.expectedLanguage);
  } else if (
    (parameters.checkFor === "output_language" ||
      parameters.checkFor === "input_matches_output") &&
    languages.output
  ) {
    match = languages.output.includes(parameters.expectedLanguage);
  }

  return {
    raw_result: result,
    value: match ? 1 : 0,
    status: match ? "succeeded" : "failed",
    costs: [],
  };
};
