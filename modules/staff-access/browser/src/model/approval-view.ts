/** The approval page's reading of a request: its phase and what approving asks of the operator. */

import type {
  StaffAccessApprovalView,
  StaffAccessSessionView,
} from "@langwatch/staff-access-contract";
import { toEpochMs } from "@langwatch/time";

export type ApprovalPhase =
  | "pending"
  | "expired"
  | "approved"
  | "lapsed"
  | "live"
  | "ended"
  | "denied"
  | "revoked";

/**
 * What became of the request: a pending one past its expiry reads as expired before the server
 * says so, and a redeemed one reads live for its hour, then ended. An approval the agent never
 * picked up reads as lapsed, not as a request nobody approved.
 */
export function approvalPhase({
  view,
  nowMs,
}: {
  view: Pick<
    StaffAccessApprovalView,
    "status" | "expiresAt" | "approvedAt" | "redeemedAt" | "accessExpiresAt"
  >;
  nowMs: number;
}): ApprovalPhase {
  switch (view.status) {
    case "pending":
      return toEpochMs(view.expiresAt) <= nowMs ? "expired" : "pending";
    case "approved":
      return toEpochMs(view.expiresAt) <= nowMs ? "lapsed" : "approved";
    case "redeemed":
      return view.accessExpiresAt !== null && toEpochMs(view.accessExpiresAt) <= nowMs
        ? "ended"
        : "live";
    case "denied":
      return "denied";
    case "expired":
      if (view.redeemedAt !== null) return "ended";
      return view.approvedAt !== null ? "lapsed" : "expired";
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
