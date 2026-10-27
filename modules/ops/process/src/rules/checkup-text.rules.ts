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
