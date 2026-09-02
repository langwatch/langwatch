/**
 * The address a customer's own SDK should post to, as the usage snippets print
 * it.
 *
 * A NARROWED FAMILY-LOCAL COPY of `platform/app/src/components/code/langwatchEndpointEnv.ts`,
 * which the checks manual-integration panel and the studio's Publish dialog
 * also read. The narrowing is real: the platform module exports the bare
 * endpoint AND the `export LANGWATCH_ENDPOINT=…` line, and only the second is
 * printed here.
 *
 * `window.location` is read behind an injectable override, which is
 * `@langwatch/gateway-web`'s `docs-url` shape: a package may read the address
 * bar, and a test may not mutate jsdom's locked `location`, so the value it
 * would have read is a parameter with a browser default.
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
 * The base URL a cURL example posts to.
 *
 * Falls back to the SaaS address, which is what a snippet rendered on a hosted
 * instance — or before the document exists — should say.
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
