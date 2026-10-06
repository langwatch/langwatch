import type { OpsSlackAlertTransport } from "../slack/slack.bug-report-notifier.channel.ts";

const CHAT_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";
/** Long enough for a slow Slack, short enough that a blackholed one does not hold intake. */
const POST_TIMEOUT_MS = 10_000;

/** The request seam, injected so a suite never opens a socket. */
export type SlackAlertFetch = (
  url: string,
  init: RequestInit & { signal: AbortSignal },
) => Promise<Response>;

/**
 * Posts one message through the Slack Web API with a bot token. Slack answers
 * 200 on a logical failure, so the outcome is read from the body's `ok` flag.
 * A redirect is refused: a 3xx would carry the bearer token somewhere else.
 */
export class HttpSlackAlertChannel implements OpsSlackAlertTransport {
  private constructor(private readonly send: SlackAlertFetch) {}

  static create({ fetch: send }: { fetch?: SlackAlertFetch } = {}): HttpSlackAlertChannel {
    return new HttpSlackAlertChannel(send ?? ((url, init) => fetch(url, init)));
  }

  async post({
    token,
    channel,
    payload,
    triggerName,
  }: Parameters<OpsSlackAlertTransport["post"]>[0]): Promise<void> {
    const label = `Slack Web API dispatch for "${triggerName}"`;
    const response = await this.send(CHAT_POST_MESSAGE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel, ...payload }),
      redirect: "error",
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    });

    if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);

    const body = (await response.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
    } | null;
    if (body === null) throw new Error(`${label}: unparseable response`);
    if (!body.ok)
      throw new Error(`${label}: Slack rejected the message: ${body.error ?? "unknown_error"}`);
  }
}
