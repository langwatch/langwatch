import type { DomainJoinSetting } from "@langwatch/identity";
import { useCallback, useMemo, useState } from "react";
import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";
import { toaster } from "../ui/toaster";
import type { PendingJoinRequest } from "./JoinRequestsTable";

/**
 * The members area's join-requests state (D12): what is waiting, the two
 * answers an admin can give, and the setting behind them.
 *
 * Hooks rather than state inside the page, and they return props rather than
 * JSX: the page owns the layout, these own the queries, the mutations and what
 * a refusal says.
 *
 * Every refusal reaches the person as WORDS. `showErrorToast` reads the
 * handled payload and renders the copy the code-keyed registry carries — the
 * wire message is the code slug since #5984, so toasting `error.message` would
 * show an admin `join_request_not_pending` and nothing else.
 */
export function useJoinRequests(scope: {
  organizationId: string;
  canManage: boolean;
}) {
  const answers = usePendingJoinRequests(scope);
  const joining = useDomainJoinSetting(scope);
  return { ...answers, ...joining };
}

/**
 * Running one answer: the mutation, what the admin is told, and which row is
 * busy while it is in flight. Both answers are the identical move, so it is
 * written once here rather than twice.
 */
function useAnswerJoinRequest({ organizationId }: { organizationId: string }) {
  const queryClient = api.useUtils();
  const [answeringId, setAnsweringId] = useState<string | null>(null);

  const answer = useCallback(
    ({
      joinRequestId,
      run,
      description,
      title,
    }: {
      joinRequestId: string;
      run: ReturnType<typeof api.joinRequests.approve.useMutation>;
      description: string;
      title: string;
    }) => {
      setAnsweringId(joinRequestId);
      run.mutate(
        { organizationId, joinRequestId },
        {
          onSuccess: () => {
            toaster.create({
              title,
              description,
              type: "success",
              duration: 5000,
            });
            void queryClient.joinRequests.pending.invalidate();
            // An approval adds a member, so the members list is stale too.
            void queryClient.organization.getOrganizationWithMembersAndTheirTeams.invalidate();
          },
          // Never `error.message`: the code-keyed registry owns the words.
          onError: (error) =>
            showErrorToast({
              error,
              fallbackTitle: "Couldn't answer that request",
            }),
          onSettled: () => setAnsweringId(null),
        },
      );
    },
    [organizationId, queryClient],
  );

  return { answeringId, answer };
}

/** What is waiting, and the two answers. */
function usePendingJoinRequests({
  organizationId,
  canManage,
}: {
  organizationId: string;
  canManage: boolean;
}) {
  // Only an admin ever asks. With the flag off the procedure answers an empty
  // list, so the panel simply does not render — no branch here needed.
  const pending = api.joinRequests.pending.useQuery(
    { organizationId },
    { enabled: !!organizationId && canManage },
  );
  const approveMutation = api.joinRequests.approve.useMutation();
  const rejectMutation = api.joinRequests.reject.useMutation();
  const { answeringId, answer } = useAnswerJoinRequest({ organizationId });

  const requests: PendingJoinRequest[] = useMemo(
    () =>
      (pending.data ?? []).map((request) => ({
        joinRequestId: request.joinRequestId,
        // Who is asking and when. The address is not in the payload at all —
        // the domain is what was matched.
        name: request.name,
        domain: request.domain,
        requestedAt: request.requestedAt,
        expiresAt: request.expiresAt,
      })),
    [pending.data],
  );

  const approve = useCallback(
    (joinRequestId: string) =>
      answer({
        joinRequestId,
        run: approveMutation,
        title: "Request approved",
        description:
          "They are a member now, with your organization's default role.",
      }),
    [answer, approveMutation],
  );

  const reject = useCallback(
    (joinRequestId: string) =>
      answer({
        joinRequestId,
        run: rejectMutation,
        title: "Request rejected",
        // No reason was asked for and none is reported back: the requester is
        // told it was not approved, and nothing about who decided.
        description: "They have been told it was not approved.",
      }),
    [answer, rejectMutation],
  );

  return { requests, answeringId, approve, reject };
}

/** How this organization has set joining, and the one write that changes it. */
function useDomainJoinSetting({
  organizationId,
  canManage,
}: {
  organizationId: string;
  canManage: boolean;
}) {
  const queryClient = api.useUtils();
  const joining = api.joinRequests.joining.useQuery(
    { organizationId },
    { enabled: !!organizationId && canManage },
  );
  const setJoiningMutation = api.joinRequests.setJoining.useMutation();

  const setJoining = useCallback(
    (next: { domainJoin: DomainJoinSetting; domains: string[] }) => {
      setJoiningMutation.mutate(
        { organizationId, ...next },
        {
          onSuccess: (result) => {
            toaster.create({
              title: "Saved",
              description: JOINING_SAVED[result.next],
              type: "success",
              duration: 5000,
            });
            void queryClient.joinRequests.joining.invalidate();
          },
          // The three refusals here — no licence, an unproven domain, an
          // identity provider that already admits it — each have their own
          // registered copy. Never `error.message`.
          onError: (error) =>
            showErrorToast({
              error,
              fallbackTitle: "Couldn't save that setting",
            }),
        },
      );
    },
    [organizationId, queryClient, setJoiningMutation],
  );

  return {
    joining: joining.data ?? {
      domainJoin: "request" as const,
      joinDomains: [],
    },
    savingJoining: setJoiningMutation.isPending,
    setJoining,
  };
}

/** What actually changed for the reader, in their terms. */
const JOINING_SAVED: Record<DomainJoinSetting, string> = {
  off: "Colleagues can no longer find or ask to join your organization.",
  request: "Colleagues on your domain can ask to join, and you decide.",
  auto: "Colleagues on the domains you named now join straight away.",
};
