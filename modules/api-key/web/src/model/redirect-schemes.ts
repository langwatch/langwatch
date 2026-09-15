// OAuth redirect_uri deny-list (not allow-list): native MCP clients use custom schemes (RFC
// 8252). List names browser-executable schemes (javascript:, data:, blob:, etc).
export const DISALLOWED_REDIRECT_SCHEMES = [
  "javascript:",
  "vbscript:",
  "data:",
  "blob:",
  "filesystem:",
] as const;

/** Whether a redirect_uri is safe to navigate to. Unparseable means no. */
export function isAllowedRedirectScheme(candidate: string): boolean {
  try {
    return !(DISALLOWED_REDIRECT_SCHEMES as readonly string[]).includes(
      new URL(candidate).protocol,
    );
  } catch {
    return false;
  }
}
