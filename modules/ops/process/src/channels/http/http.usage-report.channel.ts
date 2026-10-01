import type { UsageReportChannel, UsageReportPostAnswer } from "../usage-report.channel.ts";

/** Long enough for a slow host, short enough that a blackholed one does not hold the tick. */
const POST_TIMEOUT_MS = 30_000;

/** The request seam, injected so a suite never opens a socket. */
export type UsageReportFetch = (
  url: string,
  init: RequestInit & { signal: AbortSignal },
) => Promise<UsageReportPostAnswer>;

export class HttpUsageReportChannel implements UsageReportChannel {
  private constructor(private readonly send: UsageReportFetch) {}

  static create({ fetch: send }: { fetch?: UsageReportFetch } = {}): HttpUsageReportChannel {
    return new HttpUsageReportChannel(send ?? ((url, init) => fetch(url, init)));
  }

  async post({
    endpoint,
    body,
  }: {
    endpoint: string;
    body: Record<string, unknown>;
  }): Promise<UsageReportPostAnswer> {
    const response = await this.send(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    });
    return { status: response.status };
  }
}
