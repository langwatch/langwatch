/**
 * Reads static deployment config from meta tag, avoiding circular dependency and
 * supporting modules mounted by multiple packages.
 */

import { useMemo } from "react";

const PUBLIC_APP_CONFIG_META_NAME = "langwatch-public-config";

export type OnboardingPublicEnvironment = {
  /** Whether this installation is the hosted product. Forks the welcome flow. */
  IS_SAAS: boolean;
  /** Where a customer's SDK sends traces. Empty when the shell states none. */
  BASE_HOST: string;
};

export type OnboardingPublicEnv = {
  data: OnboardingPublicEnvironment | undefined;
  isLoading: boolean;
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

export function readOnboardingPublicEnvironment(): OnboardingPublicEnvironment {
  if (typeof document === "undefined") return { IS_SAAS: false, BASE_HOST: "" };
  const content = document
    .querySelector(`meta[name="${PUBLIC_APP_CONFIG_META_NAME}"]`)
    ?.getAttribute("content");
  if (!content) return { IS_SAAS: false, BASE_HOST: "" };
  try {
    const parsed = JSON.parse(decodeBase64Url(content)) as {
      appBaseUrl?: unknown;
      deployment?: unknown;
    };
    return {
      IS_SAAS: parsed.deployment === "saas",
      BASE_HOST: typeof parsed.appBaseUrl === "string" ? parsed.appBaseUrl : "",
    };
  } catch {
    return { IS_SAAS: false, BASE_HOST: "" };
  }
}

/**
 * The RETURN SHAPE is the platform hook's — `{ data, isLoading }` with
 * SCREAMING_SNAKE keys, matching what the seven call sites destructure.
 * `isLoading` is always false since the tag is in the document pre-render.
 */
export function usePublicEnv(): OnboardingPublicEnv {
  return useMemo(() => {
    const values = readOnboardingPublicEnvironment();
    return { data: values, isLoading: false };
  }, []);
}
