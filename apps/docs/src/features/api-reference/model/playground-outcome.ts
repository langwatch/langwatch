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

export function requestErrorOutcome({ signal }: { signal: AbortSignal }): Outcome {
  if (signal.aborted)
    return {
      kind: "error",
      message: signal.reason === "timeout" ? "Request timed out" : "Request canceled",
      retry: true,
    };
  return {
    kind: "error",
    message: "The browser could not reach this endpoint. Copy the curl request to run it locally.",
    retry: true,
  };
}
