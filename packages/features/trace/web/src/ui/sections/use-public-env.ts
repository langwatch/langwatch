/**
 * What the deployment is, as this package reads it.
 *
 * `~/hooks/usePublicEnv` composed two halves: the STATIC one, read out of the
 * `langwatch-public-config` meta tag the web boot boundary injects, and a
 * per-viewer one the `publicEnv` procedure answers. The static half came from
 * `@langwatch/ui/public-config`, and `@langwatch/ui` IS `apps/ui` — a feature
 * package that named it would close a cycle back onto the application that
 * mounts it. So the reader is here, narrowed to the two keys this family
 * actually reads.
 *
 * `BASE_HOST` is the ingestion endpoint every Integrate snippet prints and
 * `DEMO_PROJECT_SLUG` is what the Langy gate compares a project against.
 * Neither is a secret and both are already in the document by the time any
 * trace surface renders.
 *
 * THE META NAME AND THE TWO FIELD NAMES ARE A RESTATEMENT and carry the
 * alignment obligation the data-governance snapshots record: rename one in
 * `apps/ui/src/model/public-config.ts` without renaming it here and the
 * snippets print an empty endpoint.
 */

import { useMemo } from "react";

import { api } from "./trace-api";

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
 *
 * The application's reader THROWS on a missing meta tag, which is right for a
 * boot boundary and wrong here: a test that mounts one trace surface should not
 * have to stage a document, and an endpoint the reader can copy is worth less
 * than a page that renders. So a missing tag reads as "unknown deployment".
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

type ViewerCapabilities = { NEXTAUTH_PROVIDER?: string; canSendEmail?: boolean };

type PublicEnvReading = {
  data: (TracePublicEnvironment & Partial<ViewerCapabilities>) | undefined;
  isLoading: boolean;
};

/**
 * The deployment, with or without the per-viewer half.
 *
 * The two overloads the application hook carried are gone: every call site in
 * this family reads the static half only, and the one procedure read is kept so
 * a caller that asks for capabilities still gets them off the same cache entry
 * the application's own `api.publicEnv` query uses.
 */
export function usePublicEnv(options: { includeCapabilities?: boolean } = {}): PublicEnvReading {
  const includeCapabilities = options.includeCapabilities ?? false;
  const capabilities = api.publicEnv.useQuery(
    {},
    {
      enabled: includeCapabilities,
      staleTime: Infinity,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  );
  const staticValues = readTracePublicEnvironment();

  return useMemo(
    () => ({
      data: includeCapabilities
        ? capabilities.data
          ? { ...staticValues, ...capabilities.data }
          : void 0
        : staticValues,
      isLoading: includeCapabilities ? capabilities.isLoading : false,
    }),
    [
      includeCapabilities,
      capabilities.data,
      capabilities.isLoading,
      staticValues.BASE_HOST,
      staticValues.DEMO_PROJECT_SLUG,
    ],
  );
}
