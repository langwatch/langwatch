/**
 * The guided variant creates the organization and its project on leaving the tailor step.
 * `created` is set once and kept: the takeover reads it while the organization list catches up.
 * @see specs/features/onboarding/guided-welcome-takeover.feature
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { onboardingApi } from "../../../behavior/onboarding-api.ts";
import { registerOnboardingExperiment } from "../../../behavior/onboarding-experiment-registration.ts";
import type { useOnboardingFlow } from "../../../behavior/use-onboarding-flow.ts";
import { useOnboardingHost } from "../../../model/onboarding-host.ts";

/** The one thing to say when the organization could not be set up. */
export const ORG_SETUP_FAILED = "Couldn't finish setting up your organization";

type OnboardingFlow = ReturnType<typeof useOnboardingFlow>;

export interface GuidedOrganization {
  organizationId: string;
  projectSlug: string;
}

export function useGuidedOrganizationCreate({
  getFormData,
  navigation,
  fadeMs,
}: {
  getFormData: OnboardingFlow["getFormData"];
  navigation: OnboardingFlow["navigation"];
  /** How long the card fades out before the takeover comes in. */
  fadeMs: number;
}): {
  created: GuidedOrganization | null;
  leavingCard: boolean;
  isCreating: boolean;
  createGuidedOrganization: () => void;
} {
  const host = useOnboardingHost();
  const initializeOrganization = onboardingApi.onboarding.initializeOrganization.useMutation();
  const utils = onboardingApi.useUtils();
  const [created, setCreated] = useState<GuidedOrganization | null>(null);
  const [leavingCard, setLeavingCard] = useState(false);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const { mutate } = initializeOrganization;
  const createGuidedOrganization = useCallback(() => {
    const form = getFormData();
    mutate(
      {
        orgName: form.organizationName ?? "",
        phoneNumber: form.phoneNumber ?? "",
        primaryIntent: "LLM_OPS",
        // The variant rides in the sign-up answers, where the organization stores it.
        signUpData: {
          usage: form.usageStyle,
          solution: form.solutionType,
          terms: form.agreement,
          companySize: form.companySize,
          onboardingVariant: "guided",
          ...form.attribution,
        },
      },
      {
        onSuccess: (response) => {
          registerOnboardingExperiment("guided");
          setCreated({
            organizationId: response.organizationId,
            projectSlug: response.projectSlug ?? "",
          });
          void utils.organization.getAll.invalidate();
          setLeavingCard(true);
          timers.current.push(
            window.setTimeout(() => {
              navigation.nextScreen();
              setLeavingCard(false);
            }, fadeMs),
          );
        },
        onError: (error) => host.failed({ error, fallbackTitle: ORG_SETUP_FAILED }),
      },
    );
  }, [getFormData, mutate, navigation, utils, fadeMs, host]);

  return {
    created,
    leavingCard,
    isCreating: initializeOrganization.isPending || initializeOrganization.isSuccess,
    createGuidedOrganization,
  };
}
