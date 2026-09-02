/**
 * The endpoint a reader has to set, or nothing when the SDK's own default
 * already points at this deployment.
 *
 * Only a self-hosted deployment needs `LANGWATCH_ENDPOINT`. An empty base host
 * counts as the default too: emitting `LANGWATCH_ENDPOINT=""` silently breaks
 * the SDK.
 *
 * `@langwatch/trace-web` keeps the same three lines for its own onboarding
 * pane, and does not publish them; this is the home's copy rather than a
 * cross-package reach for a comparison against one constant.
 */
const CLOUD_ENDPOINT = "https://app.langwatch.ai";

export function selfHostedEndpoint(baseHost: string | undefined): string | null {
  if (!baseHost || baseHost === CLOUD_ENDPOINT) return null;
  return baseHost;
}
