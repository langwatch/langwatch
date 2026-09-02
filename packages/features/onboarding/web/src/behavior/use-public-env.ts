/**
 * What the deployment is, as this package reads it.
 *
 * `~/hooks/usePublicEnv` composed two halves: the STATIC one, read out of the
 * `langwatch-public-config` meta tag the web boot boundary injects, and a
 * per-viewer one the `publicEnv` procedure answered. Nothing in this family
 * reads the per-viewer half, so what is left is the static half — read HERE
 * rather than asked of the host, and that is a correctness requirement rather
 * than a preference.
 *
 * THE MODULES THIS READER SERVES ARE MOUNTED BY TWO PACKAGES. The observability
 * codegen, the two coding-agent screens and the OpenTelemetry setup all render
 * inside `@langwatch/trace-web`'s Integrate drawer as well as inside this
 * family's own product flow, and the explorer mounts no onboarding host. A
 * reading that came off this package's port would throw the moment the drawer
 * opened — which is exactly what it did, caught by trace-web's own suite.
 *
 * The static half comes from `@langwatch/ui/public-config` in the application,
 * and `@langwatch/ui` IS `apps/ui` — a feature package that named it would close
 * a cycle back onto the application that mounts it. So the meta tag is decoded
 * here, narrowed to the two keys this family reads, exactly as
 * `@langwatch/trace-web` does for the same reason.
 *
 * THE META NAME AND THE TWO FIELD NAMES ARE A RESTATEMENT and carry the
 * alignment obligation the data-governance snapshots record: rename one in
 * `apps/ui/src/model/public-config.ts` without renaming it here and the welcome
 * flow forks the wrong way and the snippets print an empty endpoint.
 *
 * A MISSING TAG READS AS "UNKNOWN DEPLOYMENT" rather than throwing. The
 * application's own reader throws, which is right for a boot boundary and wrong
 * here: a test that mounts one onboarding surface should not have to stage a
 * document, and an endpoint the reader can copy is worth less than a page that
 * renders.
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
 * SCREAMING_SNAKE keys — because that is what the seven call sites destructure.
 * `isLoading` is always false: the tag is in the document before any screen
 * renders, so the welcome flow's "hold the last screen until the environment
 * answers" branch still compiles and simply never holds.
 */
export function usePublicEnv(): OnboardingPublicEnv {
  return useMemo(() => {
    const values = readOnboardingPublicEnvironment();
    return { data: values, isLoading: false };
  }, []);
}
