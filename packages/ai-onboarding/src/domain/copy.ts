import type { LifecycleNotice } from "@langwatch/contracts/agent-onboarding";
import type { OnboardingConfig } from "./config.js";

/**
 * The three sentences the CLI prints after provisioning.
 *
 * Rendered server-side because the windows are deployment configuration — a
 * self-hosted install with different windows would otherwise print numbers
 * that don't match what its own server enforces.
 *
 * Per dev/docs/best_practices/copywriting.md these say what the developer
 * gets and when it ends, and never mention how any of it is stored or
 * cleaned up.
 */
export function buildLifecycleNotice(
  config: Pick<OnboardingConfig, "ingestionDays" | "retentionDays">,
): LifecycleNotice {
  return {
    dataRetention: `Your traces are collected and viewable for ${config.ingestionDays} days.`,
    claimWindow: `Claim this account within ${config.retentionDays} days to keep everything, free.`,
    afterExpiry: "Unclaimed accounts and their data are deleted after that.",
  };
}
