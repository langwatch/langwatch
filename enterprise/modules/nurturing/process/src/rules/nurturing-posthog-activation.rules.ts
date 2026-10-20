// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingSignalOf } from "@langwatch/enterprise-nurturing-contract";
import { onboardingExperimentProperties } from "@langwatch/onboarding-contract";

type ActivationSignal = NurturingSignalOf<
  "scenario_created" | "scenario_run_succeeded" | "first_trace_integrated" | "project_active_day"
>;

type ActivationTrackInput = {
  userId: string;
  event: string;
  properties: Record<string, unknown>;
};

/** The PostHog event an activation milestone is tracked as. */
export function activationTrackInput(signal: ActivationSignal): ActivationTrackInput {
  switch (signal.kind) {
    case "scenario_created": {
      const variant = signal.onboardingVariant;
      return {
        userId: signal.userId,
        event: "scenario_created",
        properties: variant
          ? { onboarding_variant: variant, ...onboardingExperimentProperties(variant) }
          : {},
      };
    }
    case "scenario_run_succeeded":
      return {
        userId: signal.userId,
        event: "scenario_run_succeeded",
        properties: {
          scenario_id: signal.scenarioId ?? null,
          run_id: signal.runId,
          connected_agent: true,
          ...onboardingExperimentProperties(signal.onboardingVariant),
        },
      };
    case "first_trace_integrated":
      return {
        userId: signal.userId,
        event: "first_trace_integrated",
        properties: { sdk_language: signal.sdkLanguage, sdk_framework: signal.sdkFramework },
      };
    case "project_active_day":
      return {
        userId: signal.userId,
        event: "project_active_day",
        properties: {
          source: signal.source,
          ...(signal.daysSinceSignup == null ? {} : { days_since_signup: signal.daysSinceSignup }),
          ...onboardingExperimentProperties(signal.onboardingVariant),
        },
      };
  }
}
