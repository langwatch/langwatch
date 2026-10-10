/** One trace, in the body shape `POST /api/collector` takes from an SDK. */
export type CollectorTrace = Readonly<Record<string, unknown>>;

/** The collector door, reached with the caller's own project key, which it authenticates. */
export interface TraceCollectorChannel {
  post(input: { authToken: string; trace: CollectorTrace }): Promise<void>;
}
