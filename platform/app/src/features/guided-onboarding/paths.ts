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
