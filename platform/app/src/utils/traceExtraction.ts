import type { Trace } from "../server/tracer/types";
import { stringifyIfObject } from "./stringifyIfObject";

/**
 * Extracts the input text from a trace, handling both plain text and JSON inputs.
 * Single Responsibility: Extract and normalize input text from trace objects for both client and server use.
 * @param trace - The trace object containing input data.
 * @returns The extracted input text or "<empty>" if no valid input found.
 */
export const getExtractedInput = (trace: Trace): string => {
  const input = trace.input;

  let value = input?.value ? stringifyIfObject(input.value) : "";

  try {
    const json: any = JSON.parse(value);

    if (typeof json?.input === "string" && json.input.length > 0) {
      value = json.input;
    }
  } catch {
    // ignore JSON parse errors - value is already a string
  }

  return value || "<empty>";
};
