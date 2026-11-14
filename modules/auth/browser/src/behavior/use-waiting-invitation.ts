import { authApi as api } from "./auth-api.ts";

/**
 * The invitation already waiting on one of the signed-in person's proven addresses, as the
 * path that accepts it. A failed read reports none, so the step behind it is never held.
 */
export function useWaitingInvitation({ enabled }: { enabled: boolean }): {
  isPending: boolean;
  acceptPath: string | null;
} {
  const invitations = api.invite.pendingForMe.useQuery(
    {},
    { enabled, retry: false, refetchOnWindowFocus: false },
  );
  const inviteCode = invitations.data?.[0]?.inviteCode;
  return {
    isPending: enabled && invitations.isLoading,
    acceptPath: inviteCode ? `/invite/accept?inviteCode=${encodeURIComponent(inviteCode)}` : null,
  };
}
