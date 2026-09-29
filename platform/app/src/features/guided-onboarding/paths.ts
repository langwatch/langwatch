/**
 * The four paths a guided onboarding can set up, shared by the server (the
 * guided state on the organization, the REST and tRPC procedures, the CLI)
 * and the client (the value screen, the tour, the Home offer).
 *
 * Framework-free on purpose: server code imports it, so nothing here may
 * reach React or the design system.
 *
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { z } from "zod";

export const GUIDED_PATHS = [
  "llmops",
  "coding",
  "gateway",
  "governance",
] as const;

export type GuidedPath = (typeof GUIDED_PATHS)[number];

export const guidedPathSchema = z.enum(GUIDED_PATHS);

export const GUIDED_PATH_TITLES: Record<GuidedPath, string> = {
  llmops: "Evals & LLM Ops",
  coding: "Coding Agent Tracking",
  gateway: "Gateway",
  governance: "Governance",
};

export function isGuidedPath(value: string): value is GuidedPath {
  return (GUIDED_PATHS as readonly string[]).includes(value);
}

/** The one-line description under each path's title on the value screen. */
export const GUIDED_PATH_DESCRIPTIONS: Record<GuidedPath, string> = {
  llmops: "Trace, test and improve the agents you are building",
  coding: "Track Claude Code and friends and find token savings",
  gateway:
    "One endpoint for every provider, with virtual keys, budgets and routing",
  governance:
    "Control all AI subscriptions and usage across company departments",
};

/**
 * Where a guided onboarding lands once the provider step is over: the page
 * Langy starts from for that path. The project pages take the project slug;
 * the organization pages resolve the ambient project on their own, and a
 * fresh organization has exactly one.
 */
export function guidedPathLanding({
  path,
  projectSlug,
}: {
  path: GuidedPath;
  projectSlug: string;
}): string {
  switch (path) {
    case "llmops":
      return `/${projectSlug}/traces`;
    case "gateway":
      return "/gateway";
    case "governance":
      return "/governance";
    case "coding":
      return "/me";
  }
}
