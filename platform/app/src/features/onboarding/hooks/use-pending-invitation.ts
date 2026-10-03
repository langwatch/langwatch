import { usePublicEnv } from "~/hooks/usePublicEnv";
import { api } from "~/utils/api";

/**
 * The invitation waiting for the signed-in person.
 *
 * Asked only on an installation where accounts are created by invitation:
 * everywhere else no request is made. A read that keeps failing after its
 * retries reports no invitation, so the page behind it is never held forever.
 *
 * Spec: specs/auth/sign-up-restriction.feature
 */
export function usePendingInvitation(): {
  isPending: boolean;
  inviteCode: string | null;
} {
  const publicEnv = usePublicEnv();
  const isInviteOnly = publicEnv.data?.SIGN_UP_MODE === "invite_only";
  const invitation = api.invite.myPendingInvitation.useQuery(
    {},
    { enabled: isInviteOnly, staleTime: 60_000 },
  );
  return {
    isPending: publicEnv.isLoading || invitation.isLoading,
    inviteCode: invitation.data?.inviteCode ?? null,
  };
}
