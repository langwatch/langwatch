import type { Action } from "./context";
import { argument } from "./context";
import { readField } from "./expect";

/** MAIL_TIMEOUT_MILLIS bounds the wait for a message to reach the sink. */
const MAIL_TIMEOUT_MILLIS = 20_000;

const MAIL_POLL_MILLIS = 500;

interface Summary {
  id: string;
  receivedAt: string;
}

/** summaries reads the sink's `{ messages: [...] }` list, keeping what it can place in time. */
export const summaries = (body: unknown): Summary[] => {
  const listed = readField({ body, path: "messages" });
  if (!Array.isArray(listed)) return [];
  return listed.flatMap((item: unknown) => {
    const id = readField({ body: item, path: "id" });
    const receivedAt = readField({ body: item, path: "receivedAt" });
    return typeof id === "string" && typeof receivedAt === "string" ? [{ id, receivedAt }] : [];
  });
};

/** newest is the latest-received summary, if any. */
export const newest = (summaries: readonly Summary[]): Summary | undefined =>
  summaries.toSorted((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))[0];

/**
 * mail reads the newest message the side's mail sink caught for `to` (and `subject`, a
 * substring), waiting for it to arrive, and keeps its first link as `{mailLink}`, or as `as`.
 */
export const mail: Action = async (context) => {
  const { mailUrl } = context;
  if (mailUrl === undefined) throw new Error("this side has no mail sink (services/mailsim)");
  const query = new URLSearchParams({ to: argument({ context, name: "to" }) });
  if (context.args.subject !== undefined) query.set("subject", context.args.subject);
  const { request } = context.side.page;
  const options = { ignoreHTTPSErrors: true, failOnStatusCode: false };
  const deadline = Date.now() + MAIL_TIMEOUT_MILLIS;
  for (;;) {
    const listed = await request.get(`${mailUrl}/api/messages?${query}`, options);
    const found = listed.ok() ? newest(summaries(await listed.json().catch(() => undefined))) : undefined;
    if (found !== undefined) {
      const message = await request.get(`${mailUrl}/api/messages/${found.id}`, options);
      const link = readField({ body: await message.json().catch(() => undefined), path: "links.0" });
      if (typeof link !== "string") throw new Error(`the message for ${query.get("to")} has no link`);
      context.values[context.args.as ?? "mailLink"] = link;
      return;
    }
    if (Date.now() > deadline) throw new Error(`no mail for ${query} within ${MAIL_TIMEOUT_MILLIS}ms`);
    await new Promise((resolve) => setTimeout(resolve, MAIL_POLL_MILLIS));
  }
};
