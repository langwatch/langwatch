import { z } from "zod";

import type { UsageReportChannel, UsageReportPostAnswer } from "../usage-report.channel.ts";

/** Long enough for a slow host, short enough that a blackholed one does not hold the tick. */
const POST_TIMEOUT_MS = 30_000;

/** The one field of cloud's reply the install reads (U8-Q-U3); anything else is ignored. */
const replySchema = z.object({
  latest_release: z.object({ release: z.string(), commit: z.string().nullable().optional() }),
});

/** The request seam, injected so a suite never opens a socket. */
export type UsageReportFetch = (
  url: string,
  init: RequestInit & { signal: AbortSignal },
) => Promise<Pick<Response, "status" | "json">>;

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
    return { status: response.status, latestRelease: await latestReleaseOf(response) };
  }
}

/** The reply's latest release, or null when the body is not JSON or names none. */
async function latestReleaseOf(
  response: Pick<Response, "json">,
): Promise<UsageReportPostAnswer["latestRelease"]> {
  try {
    const reply = replySchema.safeParse(await response.json());
    if (!reply.success) return null;
    const { release, commit } = reply.data.latest_release;
    return { release, commit: commit ?? null };
  } catch {
    return null;
  }
}
