import type { CollectorTrace, TraceCollectorChannel } from "../trace-collector.channel.ts";

const POST_TIMEOUT_MS = 30_000;

/** The request seam, injected so a suite never opens a socket. */
export type TraceCollectorFetch = (
  url: string,
  init: RequestInit & { signal: AbortSignal },
) => Promise<Response>;

/** Posts to this deployment's own public collector, as an SDK would. */
export class HttpTraceCollectorChannel implements TraceCollectorChannel {
  private constructor(
    private readonly baseUrl: string | undefined,
    private readonly send: TraceCollectorFetch,
  ) {}

  static create({
    baseUrl,
    fetch: send,
  }: {
    baseUrl: string | undefined;
    fetch?: TraceCollectorFetch;
  }): HttpTraceCollectorChannel {
    return new HttpTraceCollectorChannel(baseUrl, send ?? ((url, init) => fetch(url, init)));
  }

  async post({ authToken, trace }: { authToken: string; trace: CollectorTrace }): Promise<void> {
    if (!this.baseUrl) throw new Error("This deployment names no public base URL to post to");
    const response = await this.send(`${this.baseUrl}/api/collector`, {
      method: "POST",
      headers: { "X-Auth-Token": authToken, "Content-Type": "application/json" },
      body: JSON.stringify(trace),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`The collector answered ${response.status}`);
  }
}
