import { useEffect, useRef } from "react";

import { INVITE_ALREADY_ACCEPTED_MESSAGE } from "~/server/invites/errors";
import { api } from "~/utils/api";
import { hardRedirect } from "~/utils/hardRedirect";
import { toaster } from "~/components/ui/toaster";

export type AcceptInviteStatus =
  | "idle"
  | "loading"
  | "success"
  | "already-accepted"
  | "error";

export interface UseAcceptInviteOnceResult {
  status: AcceptInviteStatus;
  errorMessage: string | null;
}

export interface UseAcceptInviteOnceOptions {
  inviteCode: string | undefined;
  enabled: boolean;
}

/**
 * Fire `organization.acceptInvite` at most once per invite code and drive the
 * page through a small state machine.
 *
 * ## Why a `useRef` one-shot guard instead of `mutation.isIdle`?
 *
 * React StrictMode (dev) intentionally double-invokes effects **synchronously**
 * within the same render tick. During the second invocation the mutation's
 * `isIdle` flag is still `true` because react-query has not yet transitioned
 * state — a check against `isIdle` would still fire `mutate` twice. A ref set
 * immediately before `mutate()` is the only way to block the second call
 * without coupling to react-query's internal timing.
 *
 * The same ref also protects against remounts from HMR, parent re-keying, and
 * back-nav with `?inviteCode=` still in the URL.
 *
 * ## Why navigate via `window.location.href` on success/already-accepted?
 *
 * A hard navigation busts the in-memory `useOrganizationTeamProject` cache,
 * which may have been primed with stale "no org" state before the invite was
 * accepted (either on this tab or in a prior tab). A soft `router.push` would
 * otherwise bounce the user to `/onboarding/welcome`.
 */
export function useAcceptInviteOnce({
  inviteCode,
  enabled,
}: UseAcceptInviteOnceOptions): UseAcceptInviteOnceResult {
  const submittedInviteCodeRef = useRef<string | null>(null);
  const mutation = api.organization.acceptInvite.useMutation({
    onSuccess: (data) => {
      toaster.create({
        title: "Invite Accepted",
        description: `You have successfully accepted the invite for ${data.invite.organization.name}.`,
        type: "success",
        meta: { closable: true },
        duration: 5000,
      });

      hardRedirect(data.project?.slug ? `/${data.project.slug}` : "/");
    },
    onError: (error) => {
      if (error.message === INVITE_ALREADY_ACCEPTED_MESSAGE) {
        hardRedirect("/");
      }
    },
  });

  const { mutate } = mutation;
  const shouldTrigger = enabled && typeof inviteCode === "string";

  useEffect(() => {
    if (!shouldTrigger) return;
    if (submittedInviteCodeRef.current === inviteCode) return;
    submittedInviteCodeRef.current = inviteCode;
    mutate({ inviteCode });
  }, [shouldTrigger, inviteCode, mutate]);

  return {
    status: deriveStatus(mutation, shouldTrigger),
    errorMessage: mutation.error?.message ?? null,
  };
}

function deriveStatus(
  mutation: {
    isLoading: boolean;
    isSuccess: boolean;
    isError: boolean;
    error: { message: string } | null;
  },
  shouldTrigger: boolean,
): AcceptInviteStatus {
  if (!shouldTrigger) return "idle";
  if (mutation.isSuccess) return "success";
  if (mutation.isError) {
    return mutation.error?.message === INVITE_ALREADY_ACCEPTED_MESSAGE
      ? "already-accepted"
      : "error";
  }
  return "loading";
}
