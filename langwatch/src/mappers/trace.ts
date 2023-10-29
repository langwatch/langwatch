import type { Trace } from "../server/tracer/types";

export const getSlicedInput = (trace: Trace) => {
  const input = trace.input;

  let value = input.value;
  try {
    const json: any = JSON.parse(value);
    if (
      "input" in json &&
      typeof json.input === "string" &&
      json.input.length > 0
    ) {
      value = json.input;
    }
  } catch {
    // ignore
  }

  return (
    (value ? value.slice(0, 100) : "<empty>") +
    (value.length >= 100 ? "..." : "")
  );
};

export const getSlicedOutput = (trace: Trace) => {
  const value = trace.output?.value.slice(0, 600);

  return (
    (value ? value : "<empty>") +
    (trace.output && trace.output.value.length >= 600 ? "..." : "")
  );
};

export const getTotalTokensDisplay = (trace: Trace) =>
  (trace.metrics.completion_tokens ?? 0) +
  (trace.metrics.prompt_tokens ?? 0) +
  " tokens" +
  (trace.metrics.tokens_estimated ? " (estimated)" : "");
