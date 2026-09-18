import { useCallback } from "react";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { api, type RouterOutputs } from "~/utils/api";

export type SignInSecuritySettings = RouterOutputs["signInSecurity"]["get"];

/**
 * The organization's sign-in security card (GAC-09, GAC-10): locking an
 * account after repeated failures, and bounding how long a browser session
 * lasts.
 *
 * A hook returning state and callbacks, never JSX — the same shape as
 * `useTwoStepRequirement` and `useJoinRequests` beside it. Every refusal
 * reaches the administrator as words from the code-keyed registry:
 * `error.message` on a tRPC error is the code slug since #5984, never a
 * sentence.
 *
 * Specs: specs/identity/org-account-lockout.feature,
 * specs/identity/org-session-lifetime.feature.
 */
export function useSignInSecurity({
  organizationId,
  canManage,
}: {
  organizationId: string;
  canManage: boolean;
}) {
  const queryClient = api.useUtils();
  const enabled = !!organizationId && canManage;

  const settings = api.signInSecurity.get.useQuery(
    { organizationId },
    { enabled },
  );
  const saveMutation = api.signInSecurity.save.useMutation();

  const save = useCallback(
    (next: SignInSecuritySettings) => {
      saveMutation.mutate(
        { organizationId, ...next },
        {
          onSuccess: (result) => {
            toaster.create({
              title: "Saved",
              description: savedSessionMessage(result.sweptSessions),
              type: "success",
              duration: 5000,
            });
            void queryClient.signInSecurity.get.invalidate();
          },
          onError: (error) =>
            showErrorToast({
              error,
              fallbackTitle: "Couldn't save that setting",
            }),
        },
      );
    },
    [organizationId, queryClient, saveMutation],
  );

  return {
    /** Whether the card belongs on the page at all. */
    show: enabled,
    loading: settings.isLoading,
    settings: settings.data ?? {
      lockoutAfterFailedAttempts: 0,
      lockoutMinutes: 30,
      sessionIdleTimeoutMinutes: 0,
      sessionMaxLifetimeMinutes: 0,
    },
    saving: saveMutation.isPending,
    save,
  };
}

function savedSessionMessage(sweptSessions: number): string {
  if (!(sweptSessions > 0)) return "Saved.";

  const sessions = sweptSessions === 1 ? "session" : "sessions";
  const verb = sweptSessions === 1 ? "has" : "have";
  return `Saved. ${sweptSessions} ${sessions} already idle past the new limit ${verb} been signed out.`;
}
