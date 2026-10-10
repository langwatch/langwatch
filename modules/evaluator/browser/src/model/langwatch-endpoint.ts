/**
 * The endpoint address for customer SDKs, printed in usage snippets. A narrowed copy
 * of platform/app's langwatchEndpointEnv (exports the export line only). Location is
 * injectable to support testing.
 */

/** SaaS hostnames, where the SDK's own default is already correct. */
const HOSTED = new Set(["app.langwatch.ai", "docs.langwatch.ai"]);

export function langwatchEndpointEnv(
  location: { protocol: string; hostname: string; port: string } | null = typeof window ===
  "undefined"
    ? null
    : window.location,
): string {
  if (!location || HOSTED.has(location.hostname)) return "";
  const port = location.port && !["80", "443"].includes(location.port) ? `:${location.port}` : "";
  return `export LANGWATCH_ENDPOINT='${location.protocol}//${location.hostname}${port}'\n`;
}

/**
 * The base URL a cURL example posts to. Falls back to the SaaS address
 * — what a snippet on a hosted instance, or before `document` exists,
 * should say.
 */
export function langwatchEndpoint(
  location: { protocol: string; hostname: string; port: string } | null = typeof window ===
  "undefined"
    ? null
    : window.location,
): string {
  if (!location || HOSTED.has(location.hostname)) return "https://app.langwatch.ai";
  const port = location.port && !["80", "443"].includes(location.port) ? `:${location.port}` : "";
  return `${location.protocol}//${location.hostname}${port}`;
}
