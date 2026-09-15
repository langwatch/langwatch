/**
 * What the deployment is, as this package reads it.
 *
 * Wholly the static half the shell injected into the HTML: there used to be a
 * per-viewer half fetched over a `publicEnv` query, gated behind an
 * `includeCapabilities` flag nothing in this package ever set to true. The
 * query is gone; this hook was already dead weight for it.
 */

const PUBLIC_APP_CONFIG_META_NAME = "langwatch-public-config";

export type TracePublicEnvironment = {
  BASE_HOST: string;
  DEMO_PROJECT_SLUG?: string;
};

function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return decodeURIComponent(
    atob(padded)
      .split("")
      .map((character) => `%${`00${character.charCodeAt(0).toString(16)}`.slice(-2)}`)
      .join(""),
  );
}

/**
 * The two static facts, or empty when the shell did not inject them.
 */
export function readTracePublicEnvironment(): TracePublicEnvironment {
  if (typeof document === "undefined") return { BASE_HOST: "" };
  const content = document
    .querySelector(`meta[name="${PUBLIC_APP_CONFIG_META_NAME}"]`)
    ?.getAttribute("content");
  if (!content) return { BASE_HOST: "" };
  try {
    const parsed = JSON.parse(decodeBase64Url(content)) as {
      appBaseUrl?: unknown;
      demoProjectSlug?: unknown;
    };
    return {
      BASE_HOST: typeof parsed.appBaseUrl === "string" ? parsed.appBaseUrl : "",
      ...(typeof parsed.demoProjectSlug === "string"
        ? { DEMO_PROJECT_SLUG: parsed.demoProjectSlug }
        : {}),
    };
  } catch {
    return { BASE_HOST: "" };
  }
}

type PublicEnvReading = {
  data: TracePublicEnvironment;
  isLoading: false;
};

/** The deployment's static shell config. Never loading: the shell already resolved it. */
export function usePublicEnv(): PublicEnvReading {
  return { data: readTracePublicEnvironment(), isLoading: false };
}
