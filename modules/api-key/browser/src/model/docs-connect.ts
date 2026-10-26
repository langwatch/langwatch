/**
 * The `/connect/docs` consent request and the message it answers with (ADR-185). Pure: the
 * screen reads the query through here and posts only what these functions build.
 */
import {
  DOCS_SESSION_MESSAGE_TYPE,
  DOCS_SESSION_MESSAGE_VERSION,
  DOCS_SESSION_STATE_PATTERN,
  type DocsSessionKeyMinted,
  type DocsSessionMessage,
} from "@langwatch/api-key-contract";

/** Why the page will not connect, each with its own sentence on the screen. */
export type DocsConnectRefusal =
  | "malformed-request"
  | "origin-not-registered"
  | "impersonating"
  | "no-opener";

export type DocsConnectRequest =
  | Readonly<{ kind: "valid"; origin: string; state: string }>
  | Readonly<{ kind: "refused"; reason: DocsConnectRefusal }>;

/** The origin exactly as a browser reports one, or null for anything else. */
function exactOriginOf(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.hostname.includes("*")) return null;

    return url.origin === value ? value : null;
  } catch {
    return null;
  }
}

/** Reads `origin` and `state`; an origin is answered only when it is registered exactly. */
export function readDocsConnectRequest({
  query,
  registered,
}: {
  query: Readonly<Record<string, string | undefined>>;
  registered: readonly string[];
}): DocsConnectRequest {
  const origin = exactOriginOf(query.origin ?? "");
  const state = query.state ?? "";
  if (!origin || !DOCS_SESSION_STATE_PATTERN.test(state)) {
    return { kind: "refused", reason: "malformed-request" };
  }
  if (!registered.includes(origin)) return { kind: "refused", reason: "origin-not-registered" };

  return { kind: "valid", origin, state };
}

export function grantedMessage({
  state,
  minted,
}: {
  state: string;
  minted: DocsSessionKeyMinted;
}): DocsSessionMessage {
  return {
    type: DOCS_SESSION_MESSAGE_TYPE,
    version: DOCS_SESSION_MESSAGE_VERSION,
    state,
    outcome: "granted",
    token: minted.token,
    expiresAt: minted.expiresAt,
    project: { id: minted.project.id, name: minted.project.name },
  };
}

export function deniedMessage({ state }: { state: string }): DocsSessionMessage {
  return {
    type: DOCS_SESSION_MESSAGE_TYPE,
    version: DOCS_SESSION_MESSAGE_VERSION,
    state,
    outcome: "denied",
  };
}
