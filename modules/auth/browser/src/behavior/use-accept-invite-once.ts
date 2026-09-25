import { toaster } from "@langwatch/design-system/toaster";
import { useEffect, useSyncExternalStore } from "react";

import { acceptInviteResultSchema } from "../model/accept-invite-result.ts";
import { isInviteAlreadyAccepted } from "../model/invite-messages.ts";
import { authApi as api } from "./auth-api.ts";
import { captureException, toError } from "./error-capture.ts";
import { hardRedirect } from "./hard-redirect.ts";

/**
 * Module-scoped set of invite codes already `mutate`d this page session.
 * Module scope (not `useRef`) survives real unmount/remount — re-keying, HMR,
 * back-nav — not just StrictMode's double-invoke; a redirect wipes the set.
 */
const submittedInviteCodes = new Set<string>();

/**
 * Module-scoped outcome store; survives remounts while useMutation state does not
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

type AcceptInviteMutation = ReturnType<typeof api.invite.acceptInvite.useMutation>;
type AcceptInviteMutationResult = Pick<
  AcceptInviteMutation,
  "isPending" | "isSuccess" | "isError" | "error"
>;

export type AcceptInviteStatus = "idle" | "loading" | "success" | "already-accepted" | "error";

export interface UseAcceptInviteOnceResult {
  status: AcceptInviteStatus;
  /** The failure, for the page to explain via `~/features/errors`. */
  error: unknown;
}

export interface UseAcceptInviteOnceOptions {
  inviteCode: string | undefined;
  enabled: boolean;
}

function acceptedInviteDescription(result: ReturnType<typeof acceptInviteResultSchema.safeParse>) {
  if (!result.success) return "You have successfully accepted the invite.";
  return `You have successfully accepted the invite for ${result.data.invite.organization.name}.`;
}

function acceptedInviteDestination(
  result: ReturnType<typeof acceptInviteResultSchema.safeParse>,
): string {
  if (!result.success || !result.data.project?.slug) return "/";
  return `/${result.data.project.slug}`;
}

/**
 * One-shot accept per invite code; hard navigation busts useOrganizationTeamProject cache
 */
export function useAcceptInviteOnce({
  inviteCode,
  enabled,
}: UseAcceptInviteOnceOptions): UseAcceptInviteOnceResult {
  const mutation = api.invite.acceptInvite.useMutation({
    onSuccess: (data, variables) => {
      recordInviteOutcome(variables.inviteCode, {
        status: "success",
        error: null,
      });
      const accepted = acceptInviteResultSchema.safeParse(data);
      toaster.create({
        title: "Invite Accepted",
        description: acceptedInviteDescription(accepted),
        type: "success",
        duration: 5000,
      });

      hardRedirect(acceptedInviteDestination(accepted));
    },
    onError: (error, variables) => {
      if (isInviteAlreadyAccepted(error.message)) {
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
    return isInviteAlreadyAccepted(mutation.error?.message) ? "already-accepted" : "error";
  }
  // This instance's mutation is idle/loading, but a previous instance may
  // already have finished — after a page-subtree remount the one-shot guard
  // blocks a re-submit, so without this fallback the status would be stuck
  // on "loading" forever (#5550).
  if (storedOutcome) return storedOutcome.status;
  return "loading";
}
