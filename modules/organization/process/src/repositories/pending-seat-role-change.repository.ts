import type { SeatPayment } from "@langwatch/enterprise-billing-contract";
import type { OrganizationUserRole, SeatRoleChangeStatus } from "@langwatch/organization-contract";

import type { SeatPaymentRef } from "../rules/seat-role-change.rules.ts";

/** A role change waiting on its seat payment, and who asked for it (role-change-seat.feature). */
export type PendingSeatRoleChangeRecord = Readonly<{
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationUserRole;
  requestedBy: Readonly<{ id: string; name: string | null; email: string | null }>;
  payment: SeatPayment;
  url: string;
  status: SeatRoleChangeStatus;
  /** Why the role was not written (`seat_only`, `superseded`); null otherwise. */
  reason: string | null;
  /** Epoch milliseconds. */
  createdAt: number;
  /** The member's role version when the change was asked; a later role write moves it. */
  roleVersion?: number;
}>;

/** One change, always read inside its organization. */
type ChangeRef = { organizationId: string; id: string };

/**
 * The changes waiting on a seat payment. They live a week at most: an unpaid seat invoice is
 * void within a day and a checkout expires the same day. `claim` lets one applier through.
 */
export interface PendingSeatRoleChangeRepository {
  /** False, saving nothing, when the payment already names a change: one payment, one change. */
  save(record: PendingSeatRoleChangeRecord): Promise<boolean>;
  /** The change, or none once it expired. */
  findById(input: ChangeRef): Promise<PendingSeatRoleChangeRecord[]>;
  findByPayment(input: {
    organizationId: string;
    payment: SeatPaymentRef;
  }): Promise<PendingSeatRoleChangeRecord[]>;
  /** The member's latest change, if one is still kept. */
  findLatestForMember(input: {
    organizationId: string;
    userId: string;
  }): Promise<PendingSeatRoleChangeRecord[]>;
  /** The organization's latest saved change, when it still waits: one waits at a time. */
  findWaitingForOrganization(input: {
    organizationId: string;
  }): Promise<PendingSeatRoleChangeRecord[]>;
  /** True for the one caller that may apply the change now, holding it under its own token. */
  claim(input: ChangeRef & { token: string }): Promise<boolean>;
  /** Restarts the claim period while the token still holds it; false once it expired or moved. */
  renew(input: ChangeRef & { token: string }): Promise<boolean>;
  /** Frees the claim only when the token still holds it. */
  release(input: ChangeRef & { token: string }): Promise<void>;
  /** Moves a waiting change to its outcome; false, changing nothing, once it is settled. */
  settle(
    input: ChangeRef & { status: Exclude<SeatRoleChangeStatus, "waiting">; reason?: string },
  ): Promise<boolean>;
}
