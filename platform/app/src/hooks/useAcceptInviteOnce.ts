import { useEffect, useSyncExternalStore } from "react";
import { toaster } from "~/components/ui/toaster";
import { INVITE_ALREADY_ACCEPTED_MESSAGE } from "~/server/invites/errors";
import { api } from "~/utils/api";
import { hardRedirect } from "~/utils/hardRedirect";
import { captureException, toError } from "~/utils/posthogErrorCapture";

/**
 * Module-scoped set of invite codes that have already had a `mutate` call
 * dispatched during this page session. Living at module scope (not `useRef`)
 * means the guard survives real unmount/remount — parent re-keying, HMR,
 * back-nav with `?inviteCode=` still in the URL — and not just same-instance
 * double-invokes from StrictMode. A hard redirect (success or already-accepted)
 * reloads the page and wipes this set, which is the correct semantics.
 */
const submittedInviteCodes = new Set<string>();

/**
 * Module-scoped outcome store, the counterpart of `submittedInviteCodes`.
 * Because the guard above survives remounts while `useMutation` state does
 * not, a page-subtree remount after `mutate` was dispatched would otherwise
 * leave the fresh mutation instance permanently idle → status stuck on
 * "loading" and the error only visible in the console (#5550). Outcomes are
 * recorded here by the mutation callbacks (which react-query keeps alive
 * even if the dispatching component unmounted) and read back via
 * `useSyncExternalStore`, so any remounted instance resolves to the real
 * terminal state.
 */
interface InviteOutcome {
  status: Extract<AcceptInviteStatus, "success" | "already-accepted" | "error">;
  /**
   * The failure itself, not a string lifted off it. The page renders it through
   * the code-keyed registry, which needs the whole payload (code, meta, tips,
   * trace id) — `error.message` is the code slug since #5984.
   */
  error: unknown;
}
const inviteOutcomes = new Map<string, InviteOutcome>();
const outcomeListeners = new Set<() => void>();

function recordInviteOutcome(inviteCode: string, outcome: InviteOutcome): void {
  inviteOutcomes.set(inviteCode, outcome);
  for (const listener of outcomeListeners) listener();
}

function subscribeToInviteOutcomes(listener: () => void): () => void {
  outcomeListeners.add(listener);
  return () => outcomeListeners.delete(listener);
}

/** Test-only: reset the module-scoped guard + outcomes between test cases. */
export function _resetSubmittedInviteCodesForTests(): void {
  submittedInviteCodes.clear();
  inviteOutcomes.clear();
}

type AcceptInviteMutation = ReturnType<
  typeof api.organization.acceptInvite.useMutation
>;
type AcceptInviteMutationResult = Pick<
  AcceptInviteMutation,
  "isPending" | "isSuccess" | "isError" | "error"
>;

export type AcceptInviteStatus =
  | "idle"
  | "loading"
  | "success"
  | "already-accepted"
  | "error";

export interface UseAcceptInviteOnceResult {
  status: AcceptInviteStatus;
  /** The failure, for the page to explain via `~/features/errors`. */
  error: unknown;
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
    onSuccess: (data, variables) => {
      recordInviteOutcome(variables.inviteCode, {
        status: "success",
        error: null,
      });
      toaster.create({
        title: "Invite Accepted",
        description: `You have successfully accepted the invite for ${data.invite.organization.name}.`,
        type: "success",
        duration: 5000,
      });

      hardRedirect(data.project?.slug ? `/${data.project.slug}` : "/");
    },
    onError: (error, variables) => {
      if (error.message === INVITE_ALREADY_ACCEPTED_MESSAGE) {
        recordInviteOutcome(variables.inviteCode, {
          status: "already-accepted",
          error: null,
        });
        hardRedirect("/");
        return;
      }
      recordInviteOutcome(variables.inviteCode, {
        status: "error",
        error,
      });
      // Real failure (expired invite, email mismatch, …). The page explains
      // the error inline; also capture for observability.
      captureException(toError(error), {
        tags: { source: "useAcceptInviteOnce" },
      });
    },
  });

  const { mutate } = mutation;
  const shouldTrigger = enabled && typeof inviteCode === "string";

  // Terminal outcome recorded by a previous (possibly unmounted) instance of
  // this hook for the same invite code — see `inviteOutcomes` above.
  const storedOutcome = useSyncExternalStore(subscribeToInviteOutcomes, () =>
    typeof inviteCode === "string" ? inviteOutcomes.get(inviteCode) : undefined,
  );

  useEffect(() => {
    if (!shouldTrigger) return;
    if (typeof inviteCode !== "string") return;
    if (submittedInviteCodes.has(inviteCode)) return;
    submittedInviteCodes.add(inviteCode);
    mutate({ inviteCode });
  }, [shouldTrigger, inviteCode, mutate]);

  return {
    status: deriveStatus(mutation, shouldTrigger, storedOutcome),
    error: mutation.error ?? storedOutcome?.error ?? null,
  };
}

function deriveStatus(
  mutation: AcceptInviteMutationResult,
  shouldTrigger: boolean,
  storedOutcome: InviteOutcome | undefined,
): AcceptInviteStatus {
  if (!shouldTrigger) return "idle";
  if (mutation.isSuccess) return "success";
  if (mutation.isError) {
    return mutation.error?.message === INVITE_ALREADY_ACCEPTED_MESSAGE
      ? "already-accepted"
      : "error";
  }
  // This instance's mutation is idle/loading, but a previous instance may
  // already have finished — after a page-subtree remount the one-shot guard
  // blocks a re-submit, so without this fallback the status would be stuck
  // on "loading" forever (#5550).
  if (storedOutcome) return storedOutcome.status;
  return "loading";
}
