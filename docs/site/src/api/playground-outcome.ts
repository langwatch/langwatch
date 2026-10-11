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
