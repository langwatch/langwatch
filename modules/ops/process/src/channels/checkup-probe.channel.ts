/** What an HTTP probe came back with: the status, and the body as JSON where it parses. */
export interface CheckupProbeAnswer {
  readonly status: number;
  readonly body: unknown;
}

/**
 * The checkup's HTTP probes of hosts this module does not own: the connect
 * and gateway hosts, the local gateway and the pipeline canaries.
 */
export interface CheckupProbeChannel {
  /** Resolves on any HTTP answer; throws `ConnectUnreachableError` naming host and port. */
  reach(url: string): Promise<void>;
  get(input: {
    url: string;
    headers?: Readonly<Record<string, string>>;
    timeoutMs: number;
  }): Promise<CheckupProbeAnswer>;
}
