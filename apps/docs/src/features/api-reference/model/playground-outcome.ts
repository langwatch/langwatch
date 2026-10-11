import { DocsSessionError } from "../../session/model/token-provider.ts";

export type Outcome =
  | { kind: "idle" }
  | { kind: "sending" }
  | {
      kind: "response";
      status: number;
      statusText: string;
      ms: number;
      contentType: string;
      body: string;
      headers: [string, string][];
    }
  | { kind: "error"; message: string; retry: boolean };

export function requestErrorOutcome({
  error,
  signal,
}: {
  error: unknown;
  signal: AbortSignal;
}): Outcome {
  if (error instanceof DocsSessionError)
    return { kind: "error", message: error.message, retry: false };
  if (signal.aborted)
    return {
      kind: "error",
      message: signal.reason === "timeout" ? "Request timed out" : "Request cancelled",
      retry: true,
    };
  return {
    kind: "error",
    message: "The browser could not reach this endpoint. Copy the curl request to run it locally.",
    retry: true,
  };
}
