import { useUiDeployment } from "@langwatch/browser-host/capabilities";

import { api } from "./onboarding-api.ts";

/**
 * The invitation waiting for the signed-in person. Asked only on an
 * invite-only installation; a read that fails reports no invitation, so the
 * page behind it is never held. Spec: specs/auth/sign-up-restriction.feature
 */
export function usePendingInvitation(): {
  isPending: boolean;
  inviteCode: string | null;
} {
  const isInviteOnly = useUiDeployment().signUpMode === "invite_only";
  const invitation = api.invite.myPendingInvitation.useQuery(
    {},
    { enabled: isInviteOnly, staleTime: 60_000 },
  );
  return {
    isPending: isInviteOnly && invitation.isLoading,
    inviteCode: invitation.data?.inviteCode ?? null,
  };
}
