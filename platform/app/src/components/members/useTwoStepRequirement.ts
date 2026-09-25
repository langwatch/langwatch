import { useCallback } from "react";
import { showErrorToast } from "~/features/errors";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { api, type RouterOutputs } from "~/utils/api";
import { toaster } from "../ui/toaster";

export type MemberSecondFactor =
  RouterOutputs["twoStepVerification"]["memberFactors"][number];

/**
 * The members area's two-step verification state (D06): what the
 * organization requires, who can prove one, and the one write that changes
 * it.
 *
 * A hook returning state and callbacks, never JSX — the page owns the table
 * and this owns the queries. Same shape as `useJoinRequests` beside it,
 * because it is the same kind of thing: an organization-wide setting an
 * administrator turns on, plus the list it changes the meaning of.
 *
 * Every refusal reaches the administrator as WORDS from the code-keyed
 * registry. The wire message is the code slug, so toasting `error.message`
 * would show somebody `identity_mfa_enrollment_required` and nothing else.
 */
export function useTwoStepRequirement({
  organizationId,
  canManage,
}: {
  organizationId: string;
  canManage: boolean;
}) {
  const publicEnv = usePublicEnv();
  const queryClient = api.useUtils();
  // With the flag off no organization can turn the requirement on, so the
  // card does not render and nothing is asked for.
  const offered = publicEnv.data?.MFA_ENROLLMENT_OPEN === true;
  const enabled = offered && !!organizationId && canManage;

  const requirement = api.twoStepVerification.requirement.useQuery(
    { organizationId },
    { enabled },
  );
  const members = api.twoStepVerification.memberFactors.useQuery(
    { organizationId },
    { enabled },
  );
  const setRequirementMutation =
    api.twoStepVerification.setRequirement.useMutation();

  const setRequirement = useCallback(
    (mfaRequired: boolean) => {
      setRequirementMutation.mutate(
        { organizationId, mfaRequired },
        {
          onSuccess: () => {
            toaster.create({
              title: "Saved",
              description: mfaRequired
                ? "Members who cannot prove a second factor will be asked to set one up before they can reach this organization. Nobody has been signed out."
                : "Members are no longer asked for a second factor here. Anybody who set one up keeps it.",
              type: "success",
              duration: 5000,
            });
            void queryClient.twoStepVerification.requirement.invalidate();
            void queryClient.twoStepVerification.memberFactors.invalidate();
          },
          onError: (error) =>
            showErrorToast({
              error,
              fallbackTitle: "Couldn't save that setting",
            }),
        },
      );
    },
    [organizationId, queryClient, setRequirementMutation],
  );

  const byUser = new Map<string, MemberSecondFactor>(
    (members.data ?? []).map((member) => [member.userId, member]),
  );

  return {
    /** Whether the card and the column belong on the page at all. */
    show: enabled,
    mfaRequired: requirement.data?.mfaRequired ?? false,
    connection: requirement.data?.connection ?? {
      connected: false,
      assertedFactors: [],
      assertsSecondFactor: false,
    },
    members: members.data ?? [],
    byUser,
    /** How many members the requirement is holding, or would hold. */
    heldCount: (members.data ?? []).filter(
      (member) => !member.satisfaction.satisfied,
    ).length,
    saving: setRequirementMutation.isPending,
    setRequirement,
  };
}
