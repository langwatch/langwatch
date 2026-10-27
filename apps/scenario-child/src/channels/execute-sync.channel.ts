/**
 * How a code or workflow target's one `execute_flow` POST reaches its project's engine. The
 * adapters read only `ok`, `status` and the body as text, and classify every failure themselves.
 * @see specs/scenarios/execute-sync-relay.feature
 */

/** The engine's own path for a synchronous studio execution. */
export const EXECUTE_SYNC_ENGINE_PATH = "/go/studio/execute_sync";

/** The control plane's path for the same, authenticated by the project key. */
export const EXECUTE_SYNC_RELAY_PATH = "/api/scenario/execute-sync";

/** The engine's answer to one POST; `text` is read exactly once (lw#3439). */
export type ExecuteSyncResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

export interface ExecuteSyncTransport {
  /** Named on the span and in every error, so a failure says where it went. */
  readonly endpoint: string;
  /** Posts one event; a transport failure propagates unwrapped for the adapter to classify. */
  post(input: {
    event: unknown;
    signal: AbortSignal;
    timeoutMs: number;
  }): Promise<ExecuteSyncResponse>;
}
