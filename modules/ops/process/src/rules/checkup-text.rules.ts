import type { CheckVerdict } from "@langwatch/ops-contract";

export const NOT_ASKED_FOR: CheckVerdict = {
  outcome: "unchecked",
  detail:
    "Not run. This check opens a connection or spends money, so it runs only when you ask for it.",
};

export function firstLine(text: string): string {
  const line = text.split("\n")[0] ?? "";
  return line.length > 200 ? `${line.slice(0, 197)}...` : line;
}

/** Masks the user and password of every URL in the text before a row shows it. */
export function withoutUserInfo(text: string): string {
  // Greedy up to the authority's last "@", so a raw "@" in a password is masked too.
  return text.replace(/(\/\/)[^/\s]*@/g, "$1***@");
}

export function reasonOf(error: unknown): string {
  return firstLine(
    error instanceof Error ? error.message : (JSON.stringify(error) ?? "unknown error"),
  );
}

export function bodyText(body: unknown): string {
  if (typeof body === "string") return body;
  if (body && typeof body === "object" && "message" in body) return String(body.message);
  return JSON.stringify(body ?? null);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function portOf(url: string): number {
  try {
    const parsed = new URL(url);
    if (parsed.port) return Number(parsed.port);
    return parsed.protocol === "http:" ? 80 : 443;
  } catch {
    return 443;
  }
}

export function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

/** Sync refusals an outbound firewall rule can fix. */
const NETWORK_SYNC_REFUSALS: ReadonlySet<string> = new Set([
  "connect_unreachable",
  "hosted_service_unavailable",
]);

/** A license sync refusal in plain words; the code itself is never shown. */
const SYNC_REFUSAL_SENTENCES: Readonly<Record<string, string>> = {
  connect_unreachable: "This install could not reach LangWatch",
  hosted_service_unavailable: "LangWatch did not answer with a result",
  connect_license_revoked: "LangWatch revoked this license",
  connect_license_expired: "The license has expired",
  connect_license_not_registered: "LangWatch has no hosted services set up for this license",
  connect_wrong_instance: "The license is bound to another install",
  connect_credential_pending: "LangWatch is still preparing this license's key",
  connect_license_token_malformed: "The stored license could not be read",
  rate_limited: "LangWatch asked this install to slow down",
};

export function syncRefusalSentence(code: string): string {
  return Object.hasOwn(SYNC_REFUSAL_SENTENCES, code)
    ? (SYNC_REFUSAL_SENTENCES[code] ?? "LangWatch refused the sync")
    : "LangWatch refused the sync";
}

export function isNetworkSyncRefusal(code: string): boolean {
  return NETWORK_SYNC_REFUSALS.has(code);
}
