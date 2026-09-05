/**
 * What the deployment is, as this package reads it.
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
