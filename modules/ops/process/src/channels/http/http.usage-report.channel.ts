import { selfHostedNoticeSchema } from "@langwatch/ops-contract";
import { z } from "zod";

import type { UsageReportChannel, UsageReportPostAnswer } from "../usage-report.channel.ts";

/** Long enough for a slow host, short enough that a blackholed one does not hold the tick. */
const POST_TIMEOUT_MS = 30_000;

/** The reply's latest release (U8-Q-U3); anything else but the notices is ignored. */
const replySchema = z.object({
  latest_release: z.object({ release: z.string(), commit: z.string().nullable().optional() }),
});

/** The reply's notices, read apart so one malformed notice never loses the rest. */
const noticesReplySchema = z.object({ notices: z.array(z.unknown()) });

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
    const reply = await replyOf(response);
    return {
      status: response.status,
      latestRelease: latestReleaseOf(reply),
      notices: noticesOf(reply),
    };
  }
}

/** The reply body, or undefined when it is not JSON. */
async function replyOf(response: Pick<Response, "json">): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

/** The reply's latest release, or null when it names none. */
function latestReleaseOf(reply: unknown): UsageReportPostAnswer["latestRelease"] {
  const parsed = replySchema.safeParse(reply);
  if (!parsed.success) return null;
  const { release, commit } = parsed.data.latest_release;
  return { release, commit: commit ?? null };
}

/** Each well-formed notice the reply names; a malformed one is dropped alone. */
function noticesOf(reply: unknown): UsageReportPostAnswer["notices"] {
  const parsed = noticesReplySchema.safeParse(reply);
  if (!parsed.success) return [];
  return parsed.data.notices.flatMap((each) => {
    const notice = selfHostedNoticeSchema.safeParse(each);
    return notice.success ? [notice.data] : [];
  });
}
