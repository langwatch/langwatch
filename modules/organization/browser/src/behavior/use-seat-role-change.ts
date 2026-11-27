/**
 * A role change that buys the full seat it needs: the one click, the payment page a charge may
 * still wait on, and the refusal when billing is held on our side.
 * Spec: specs/licensing/role-change-seat.feature
 */

import type { SeatRoleOfferKind } from "@langwatch/enterprise-billing-client";
import { withArticle } from "@langwatch/enterprise-billing-contract";
import type {
  MemberRoleWithSeatResult,
  PendingSeatRoleChange,
  SeatRoleChangeStatus,
} from "@langwatch/organization-contract";
import { useEffect, useRef, useState } from "react";

import type { OrganizationUserRole } from "../model/prisma-types.ts";
import { readHandledError } from "./handled-error-form.tsx";
import { api } from "./organization-api.ts";
import { useOrganizationToaster, useShowErrorToast } from "./organization-feedback.ts";
import { askOnReturn, paymentAsker } from "./payment-asker.ts";
import { reportUnexpected } from "./report-unexpected.ts";

export type SeatRoleFlow =
  | { step: "idle" }
  | { step: "busy" | "done" | "stuck" | "failed" | "superseded"; role: OrganizationUserRole }
  | { step: "waiting"; role: OrganizationUserRole; changeId: string; url: string }
  | { step: "seat_only"; role: OrganizationUserRole; reason: string };

type CompleteChange = (input: {
  organizationId: string;
  changeId: string;
}) => Promise<{ status: SeatRoleChangeStatus; reason: string | null }>;

type SeatChangeAnswer = MemberRoleWithSeatResult | { status: "refused"; error: unknown };

/** Billing held on our side refuses by name; the role stays and nothing was charged. */
function isStuck(error: unknown): boolean {
  return readHandledError(error)?.code === "subscription_ambiguous";
}

/** Where the drawer stands once the server answered the one click. */
function flowAfter({
  answer,
  role,
}: {
  answer: SeatChangeAnswer;
  role: OrganizationUserRole;
}): SeatRoleFlow {
  if (answer.status === "refused")
    return isStuck(answer.error) ? { step: "stuck", role } : { step: "idle" };
  if (answer.status === "payment_required") {
    return { step: "waiting", role, changeId: answer.changeId, url: answer.url };
  }
  if (answer.status === "seat_only") return { step: "seat_only", role, reason: answer.reason };
  return answer.seatAdded ? { step: "done", role } : { step: "idle" };
}

/** Where the drawer stands once a change waiting on its payment settled. */
function flowOnSettled({
  settled,
  role,
}: {
  settled: SeatRoleSettled;
  role: OrganizationUserRole;
}): SeatRoleFlow {
  if (settled.status === "seat_only") return { step: "seat_only", role, reason: settled.reason };
  if (settled.status === "superseded") return { step: "superseded", role };
  return { step: settled.status === "applied" ? "done" : "failed", role };
}

/** After the one click: toasts a refusal, re-reads the counts, and says once what changed. */
async function settleAnswer({
  answer,
  refresh,
  announce,
  refused,
}: {
  answer: SeatChangeAnswer;
  refresh: (change: SeatRoleChanged) => Promise<string | undefined>;
  announce: (change: { seatAdded: boolean; extra?: string }) => void;
  refused: (error: unknown) => void;
}): Promise<void> {
  if (answer.status === "refused") {
    if (!isStuck(answer.error)) refused(answer.error);
    return;
  }
  // A payment to finish waits in the drawer, which links to it and asks until it settles.
  if (answer.status === "payment_required") return;
  // The seat was paid even when the role was refused, so the counts are read again.
  if (answer.status === "seat_only") {
    await refresh({ teamsLeftWithoutAdmin: [], roleChanged: false });
    return;
  }
  const extra = await refresh({
    teamsLeftWithoutAdmin: answer.teamsLeftWithoutAdmin,
    roleChanged: true,
  });
  announce({ seatAdded: answer.seatAdded, extra });
}

/** What a seat-paid change did: `roleChanged` is false when only the seat was bought. */
export type SeatRoleChanged = { teamsLeftWithoutAdmin: { name: string }[]; roleChanged: boolean };

/** The toast line under "<Name> is now an Admin": the seat bought, then any team left adminless. */
function seatToastDescription({
  seatAdded,
  amountDue,
  extra,
}: {
  seatAdded: boolean;
  amountDue: string | undefined;
  extra: string | undefined;
}): string | undefined {
  const paid = amountDue ? `1 seat added, ${amountDue} paid.` : "1 seat added.";
  const line = [seatAdded ? paid : undefined, extra].filter(Boolean).join(" ");
  return line || undefined;
}

/** The success toast: "<Name> is now an Admin", the seat bought, any team left adminless. */
function roleChangedToast({
  role,
  seatAdded,
  extra,
  memberName,
  amountDue,
  describeRole,
}: {
  role: OrganizationUserRole;
  seatAdded: boolean;
  extra?: string;
  memberName: string;
  amountDue: string | undefined;
  describeRole: (role: OrganizationUserRole) => string;
}) {
  return {
    title: `${memberName} is now ${withArticle(describeRole(role))}`,
    description: seatToastDescription({ seatAdded, amountDue, extra }),
    type: "success",
    duration: extra ? 10000 : undefined,
  };
}

/** A reopened drawer picks up the change still waiting on its payment. */
function useResumeWaitingChange({
  pendingChange,
  setFlow,
}: {
  pendingChange: PendingSeatRoleChange | undefined;
  setFlow: (update: (current: SeatRoleFlow) => SeatRoleFlow) => void;
}) {
  useEffect(() => {
    if (pendingChange?.status !== "waiting") return;
    const { role, changeId, url } = pendingChange;
    setFlow((current) =>
      current.step === "idle" ? { step: "waiting", role, changeId, url } : current,
    );
  }, [pendingChange, setFlow]);
}

/** Asks once whether the payment landed; a failed ask leaves the change waiting. */
async function askPaid({
  completeChange,
  organizationId,
  changeId,
}: {
  completeChange: CompleteChange;
  organizationId: string;
  changeId: string;
}): Promise<{ status: SeatRoleChangeStatus; reason: string | null }> {
  try {
    return await completeChange({ organizationId, changeId });
  } catch (error) {
    reportUnexpected(error, { action: "completeSeatRoleChange" });
    return { status: "waiting", reason: null };
  }
}

/** A settled change, as the drawer shows it. */
export type SeatRoleSettled =
  | { status: "applied" | "failed" | "superseded"; reason: null }
  | { status: "seat_only"; reason: string };

/** While a change waits on its payment: asks each time the admin comes back to this window. */
function useWaitForPayment({
  organizationId,
  waiting,
  completeChange,
  onSettled,
}: {
  organizationId: string;
  waiting: { changeId: string; role: OrganizationUserRole } | undefined;
  completeChange: CompleteChange;
  onSettled: (settled: SeatRoleSettled, role: OrganizationUserRole) => void;
}) {
  // The latest callbacks, read by the timer without restarting it on every render.
  const latest = useRef({ completeChange, onSettled });
  useEffect(() => {
    latest.current = { completeChange, onSettled };
  });
  const changeId = waiting?.changeId;
  const role = waiting?.role;
  useEffect(() => {
    if (changeId === undefined || role === undefined) return;
    return askOnReturn(
      paymentAsker({
        ask: () =>
          askPaid({ completeChange: latest.current.completeChange, organizationId, changeId }),
        isSettled: (answer) => answer.status !== "waiting",
        onSettled: ({ status, reason }) => {
          if (status === "waiting") return;
          latest.current.onSettled(
            status === "seat_only" ? { status, reason: reason ?? "" } : { status, reason: null },
            role,
          );
        },
      }),
    );
  }, [changeId, role, organizationId]);
}

export function useSeatRoleChange({
  organizationId,
  userId,
  memberName,
  enabled,
  onChanged,
  describeRole,
}: {
  organizationId: string;
  userId: string;
  memberName: string;
  enabled: boolean;
  /** Applies what was staged once the role changed, re-reads what it touched, names teams left
   * without an admin. */
  onChanged: (change: SeatRoleChanged) => Promise<string | undefined>;
  describeRole: (role: OrganizationUserRole) => string;
}) {
  const toaster = useOrganizationToaster();
  const showErrorToast = useShowErrorToast();
  const [flow, setFlow] = useState<SeatRoleFlow>({ step: "idle" });
  const [offerKind, setOfferKind] = useState<SeatRoleOfferKind | undefined>(undefined);
  // The flow belongs to the member it was started for, never the next one opened; a late
  // answer from an earlier member or a cleared flow sees a newer generation and is dropped.
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    setFlow({ step: "idle" });
    setOfferKind(undefined);
  }, [organizationId, userId]);
  const [amountDue, setAmountDue] = useState<string | undefined>(undefined);
  const changeWithSeat = api.organization.changeMemberRoleWithSeat.useMutation();
  const complete = api.organization.completeSeatRoleChange.useMutation();
  const recordBlocked = api.organization.recordBlockedRoleChange.useMutation();
  // The refused attempts already kept, so a re-render or a re-pick records each once.
  const recordedBlocks = useRef(new Set<string>());
  const pending = api.organization.pendingSeatRoleChange.useQuery(
    { organizationId, userId },
    { enabled },
  );

  useResumeWaitingChange({ pendingChange: pending.data, setFlow });

  const announce = (change: { role: OrganizationUserRole; seatAdded: boolean; extra?: string }) =>
    toaster.create(roleChangedToast({ ...change, memberName, amountDue, describeRole }));

  /** Re-reads every seat count and list the change touched; a failed re-read hides no toast. */
  const refresh = (change: SeatRoleChanged) =>
    onChanged(change).catch((error: unknown) => {
      reportUnexpected(error, { action: "seatRoleChangeRefresh" });
      return undefined;
    });

  useWaitForPayment({
    organizationId,
    waiting: flow.step === "waiting" ? flow : undefined,
    completeChange: complete.mutateAsync,
    onSettled: (settled, role) => {
      setFlow(flowOnSettled({ settled, role }));
      if (settled.status === "failed") return;
      void refresh({ teamsLeftWithoutAdmin: [], roleChanged: settled.status === "applied" }).then(
        (extra) => {
          if (settled.status === "applied") announce({ role, seatAdded: true, extra });
        },
      );
    },
  });

  /** One click: buys the seat and changes the role, or waits on the payment it needs. */
  const start = async ({ role, quotedAt }: { role: OrganizationUserRole; quotedAt?: number }) => {
    const started = generation.current;
    setFlow({ step: "busy", role });
    const answer: SeatChangeAnswer = await changeWithSeat
      .mutateAsync({ organizationId, userId, role, quotedAt })
      .catch((error: unknown) => ({ status: "refused" as const, error }));
    if (generation.current !== started) return;
    setFlow(flowAfter({ answer, role }));
    await settleAnswer({
      answer,
      refresh,
      announce: (change) => announce({ role, ...change }),
      refused: (error) => showErrorToast({ error, fallbackTitle: "Couldn't update this member" }),
    });
  };

  /** The offer was refused for two live subscriptions: the calm state, the attempt kept once. */
  const block = ({ role }: { role: OrganizationUserRole }) => {
    setFlow({ step: "stuck", role });
    const key = `${organizationId}:${userId}:${role}`;
    if (recordedBlocks.current.has(key)) return;
    recordedBlocks.current.add(key);
    recordBlocked.mutateAsync({ organizationId, userId, role }).catch((error: unknown) => {
      reportUnexpected(error, { action: "recordBlockedRoleChange" });
    });
  };

  return {
    flow,
    block,
    offerKind,
    setOfferKind,
    setAmountDue,
    start,
    clear: () => {
      generation.current += 1;
      setFlow({ step: "idle" });
    },
  };
}
