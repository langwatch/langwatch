/**
 * The Sessions page link to one session: `session=<id>`, `sessionName=<name>` for the newest
 * session with that name, or both (the name answers when the id is not listed).
 * Spec: specs/coding-agent/sessions-screen.feature
 */

export const SESSION_LINK_PARAM = "session";
export const SESSION_NAME_LINK_PARAM = "sessionName";

/** The address keys the link is made of, removed once it is applied. */
export const SESSION_LINK_KEYS: readonly string[] = [SESSION_LINK_PARAM, SESSION_NAME_LINK_PARAM];

export type SessionLink =
  | Readonly<{ kind: "id"; sessionId: string; sessionName?: string }>
  | Readonly<{ kind: "name"; sessionName: string }>;

/** What the address asks for, or null when it names no session. */
export function findSessionLink(
  query: Readonly<Record<string, string | undefined>>,
): SessionLink | null {
  const sessionId = query[SESSION_LINK_PARAM]?.trim();
  const sessionName = query[SESSION_NAME_LINK_PARAM]?.trim();
  if (sessionId)
    return sessionName ? { kind: "id", sessionId, sessionName } : { kind: "id", sessionId };
  if (sessionName) return { kind: "name", sessionName };
  return null;
}

/** The listed session the link names: by id, else the newest one with the name. */
export function sessionOfLink<
  Row extends { sessionId: string; title: string | null; lastUpdateAtMs: number },
>({ link, rows }: { link: SessionLink; rows: readonly Row[] }): Row | null {
  if (link.kind === "id") {
    const byId = rows.find((row) => row.sessionId === link.sessionId);
    if (byId) return byId;
    if (!link.sessionName) return null;
  }
  const sessionName = link.sessionName;
  let newest: Row | null = null;
  for (const row of rows) {
    if (row.title?.trim() !== sessionName) continue;
    if (newest === null || row.lastUpdateAtMs > newest.lastUpdateAtMs) newest = row;
  }
  return newest;
}

/** The address patch that drops the link and keeps everything else, Langy's question included. */
export function withoutSessionLink(): Record<string, undefined> {
  return Object.fromEntries(SESSION_LINK_KEYS.map((key) => [key, void 0]));
}
