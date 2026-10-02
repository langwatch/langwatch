import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import { SlackWebApiChannel, type SlackIdentityResult } from "../slack-web-api.channel.ts";

const logger = createLogger("langwatch:slack:webApi");

const AUTH_TEST_URL = "https://slack.com/api/auth.test";
/** A slow endpoint must not pin a request for the life of the process. */
const REQUEST_TIMEOUT_MS = 10_000;

/** External input: a payload that is not this shape reads as `bad_response`. */
const slackAuthTestResponseSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  team_id: z.string().min(1).optional(),
  team: z.string().min(1).optional(),
});

/**
 * `auth.test` over HTTPS, redirects refused so the token is never re-sent. A
 * transport failure is `request_failed`, not a throw: to the customer, "Slack
 * refused" and "we could not reach Slack" are the same next step.
 */
export class HttpSlackWebApiChannel extends SlackWebApiChannel {
  private constructor(private readonly fetchImpl: typeof globalThis.fetch) {
    super();
  }

  static create({ fetch }: { fetch?: typeof globalThis.fetch } = {}): HttpSlackWebApiChannel {
    return new HttpSlackWebApiChannel(fetch ?? globalThis.fetch);
  }

  async fetchWorkspaceIdentity({ token }: { token: string }): Promise<SlackIdentityResult> {
    let body: string;
    try {
      const response = await this.fetchImpl(AUTH_TEST_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "",
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status >= 300 && response.status < 400)
        return { ok: false, error: "bad_response" };
      body = await response.text();
    } catch (error) {
      // The token never goes in the log fields; the cause does.
      logger.warn({ error }, "Could not reach Slack auth.test, reporting request_failed");
      return { ok: false, error: "request_failed" };
    }

    const parsed = safeJson({ body });
    const answer = slackAuthTestResponseSchema.safeParse(parsed[0]);
    if (parsed.length === 0 || !answer.success) return { ok: false, error: "bad_response" };
    if (!answer.data.ok) return { ok: false, error: answer.data.error ?? "unknown_error" };
    // An `ok` answer without a workspace is not the shape we compiled against.
    if (!answer.data.team_id) return { ok: false, error: "bad_response" };
    return {
      ok: true,
      identity: { teamId: answer.data.team_id, teamName: answer.data.team ?? answer.data.team_id },
    };
  }
}

/** Zero or one parsed value. */
function safeJson({ body }: { body: string }): unknown[] {
  try {
    return [JSON.parse(body)];
  } catch {
    return [];
  }
}
