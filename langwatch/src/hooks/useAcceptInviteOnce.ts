import { useEffect } from "react";

import { INVITE_ALREADY_ACCEPTED_MESSAGE } from "~/server/invites/errors";
import { api } from "~/utils/api";
import { hardRedirect } from "~/utils/hardRedirect";
import { captureException } from "~/utils/posthogErrorCapture";
import { toaster } from "~/components/ui/toaster";

/**
 * Module-scoped set of invite codes that have already had a `mutate` call
 * dispatched during this page session. Living at module scope (not `useRef`)
 * means the guard survives real unmount/remount — parent re-keying, HMR,
 * back-nav with `?inviteCode=` still in the URL — and not just same-instance
 * double-invokes from StrictMode. A hard redirect (success or already-accepted)
 * reloads the page and wipes this set, which is the correct semantics.
 */
const submittedInviteCodes = new Set<string>();

/** Test-only: reset the module-scoped guard between test cases. */
export function _resetSubmittedInviteCodesForTests(): void {
  submittedInviteCodes.clear();
}

type AcceptInviteMutation = ReturnType<
  typeof api.organization.acceptInvite.useMutation
>;
type AcceptInviteMutationResult = Pick<
  AcceptInviteMutation,
  "isLoading" | "isSuccess" | "isError" | "error"
>;

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
 * ## Why a module-scoped `Set` one-shot guard instead of `mutation.isIdle` or `useRef`?
 *
 * React StrictMode (dev) intentionally double-invokes effects **synchronously**
 * within the same render tick. During the second invocation the mutation's
 * `isIdle` flag is still `true` because react-query has not yet transitioned
 * state — a check against `isIdle` would still fire `mutate` twice. A guard
 * set immediately before `mutate()` is the only way to block the second call
 * without coupling to react-query's internal timing.
 *
 * The guard lives at **module scope** (not in a `useRef`) because a ref resets
 * whenever the component actually unmounts and remounts — HMR, parent re-keying,
 * or back-nav with `?inviteCode=` still in the URL would all resubmit. A
 * module-scoped `Set` survives those remounts; a successful `hardRedirect`
 * reloads the page and wipes the set, which is the correct semantics.
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
        return;
      }
      // Real failure (expired invite, email mismatch, …). The page renders
      // `errorMessage` inline; also capture for observability.
      captureException(error, { tags: { source: "useAcceptInviteOnce" } });
    },
  });

  const { mutate } = mutation;
  const shouldTrigger = enabled && typeof inviteCode === "string";

  useEffect(() => {
    if (!shouldTrigger) return;
    if (typeof inviteCode !== "string") return;
    if (submittedInviteCodes.has(inviteCode)) return;
    submittedInviteCodes.add(inviteCode);
    mutate({ inviteCode });
  }, [shouldTrigger, inviteCode, mutate]);

  return {
    status: deriveStatus(mutation, shouldTrigger),
    errorMessage: mutation.error?.message ?? null,
  };
}

function deriveStatus(
  mutation: AcceptInviteMutationResult,
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
