import { usePublicEnv } from "~/hooks/usePublicEnv";
import { api } from "~/utils/api";

/**
 * The invitation waiting for the signed-in person.
 *
 * Asked only on an installation where accounts are created by invitation:
 * everywhere else no request is made. A failed read reports no invitation.
 *
 * Spec: specs/auth/sign-up-restriction.feature
 */
export function usePendingInvitation(): {
  isPending: boolean;
  inviteCode: string | null;
} {
  const publicEnv = usePublicEnv();
  const inviteOnly = publicEnv.data?.SIGN_UP_MODE === "invite_only";
  const invitation = api.invite.myPendingInvitation.useQuery(
    {},
    { enabled: inviteOnly, staleTime: 60_000, retry: false },
  );
  return {
    isPending: publicEnv.isLoading || invitation.isLoading,
    inviteCode: invitation.data?.inviteCode ?? null,
  };
}
