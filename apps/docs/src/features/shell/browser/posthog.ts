/* The LangWatch EU project's public client key, the same one the marketing site and app use. */
const POSTHOG_KEY = "phc_oOlj3H19T2JlGbFXmrGrjSLbDPDNyPKYdIFaTdrkXOY";
/** The marketing site's first-party proxy to PostHog EU, on the docs' own origin. */
export const POSTHOG_PROXY_PATH = "/ingest";

type PostHogQueue = unknown[] & { _i?: unknown[]; people?: unknown[] };
type PostHogWindow = Window & { posthog?: PostHogQueue };

/** The settings the docs start PostHog with: pageviews on every navigation, no recordings. */
export function postHogConfig({ origin }: { origin: string }) {
  return {
    api_host: `${origin}${POSTHOG_PROXY_PATH}`,
    ui_host: "https://eu.posthog.com",
    person_profiles: "always",
    capture_pageview: "history_change",
    disable_session_recording: true,
  } as const;
}

/**
 * Queues PostHog's init where its loader replays it, then adds the loader from the proxy, once.
 * Called only after the reader accepted cookies, by the tag manager's loader.
 */
export function loadPostHog({ win = window }: { win?: PostHogWindow } = {}) {
  if (win.posthog) return;
  const origin = win.location.origin;
  win.posthog = Object.assign([], {
    _i: [[POSTHOG_KEY, postHogConfig({ origin }), "posthog"]],
    people: [],
  });
  const script = win.document.createElement("script");
  script.async = true;
  script.src = `${origin}${POSTHOG_PROXY_PATH}/static/array.js`;
  win.document.head.append(script);
}
