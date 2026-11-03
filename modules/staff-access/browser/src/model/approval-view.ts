/** The approval page's reading of a request: its phase and what approving asks of the operator. */

import type {
  StaffAccessApprovalView,
  StaffAccessSessionView,
} from "@langwatch/staff-access-contract";
import { toEpochMs } from "@langwatch/time";

export type ApprovalPhase = "pending" | "expired" | "approved" | "denied" | "revoked";

/** A pending request past its expiry reads as expired before the server says so. */
export function approvalPhase({
  view,
  nowMs,
}: {
  view: Pick<StaffAccessApprovalView, "status" | "expiresAt">;
  nowMs: number;
}): ApprovalPhase {
  switch (view.status) {
    case "pending":
      return toEpochMs(view.expiresAt) <= nowMs ? "expired" : "pending";
    case "approved":
    case "redeemed":
      return "approved";
    case "denied":
      return "denied";
    case "expired":
      return "expired";
    case "revoked":
      return "revoked";
  }
}

export function isTypedNameRequired({
  view,
  spendApproved,
}: {
  view: Pick<StaffAccessApprovalView, "typedNameRequired">;
  spendApproved: boolean;
}): boolean {
  return spendApproved ? view.typedNameRequired.withSpend : view.typedNameRequired.withoutSpend;
}

/** Approve is offered once the typed name, when asked for, matches exactly. */
export function canApprove({
  view,
  spendApproved,
  typedName,
}: {
  view: Pick<StaffAccessApprovalView, "typedNameRequired" | "organizationName">;
  spendApproved: boolean;
  typedName: string;
}): boolean {
  if (!isTypedNameRequired({ view, spendApproved })) return true;
  return typedName.trim() !== "" && typedName.trim() === (view.organizationName ?? "").trim();
}

/** "9:41" from milliseconds left; never negative. */
export function formatCountdown(msLeft: number): string {
  const totalSeconds = Math.max(0, Math.ceil(msLeft / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** A session an operator can still end: undecided, approved, or picked up and not yet over. */
export function isRevocable({
  session,
  nowMs,
}: {
  session: Pick<StaffAccessSessionView, "status" | "expiresAt" | "accessExpiresAt">;
  nowMs: number;
}): boolean {
  if (session.status === "pending" || session.status === "approved") {
    return session.status === "approved" || toEpochMs(session.expiresAt) > nowMs;
  }
  if (session.status !== "redeemed") return false;
  return session.accessExpiresAt === null || toEpochMs(session.accessExpiresAt) > nowMs;
}
