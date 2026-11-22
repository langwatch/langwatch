import type { SignInIdpKind } from "@langwatch/identity-contract";
import type { SeatRequestSource, SeatRequestStatus } from "@langwatch/organization-contract";

/** One seat request as it is stored; timestamps are epoch milliseconds. */
export type SeatRequestRow = Readonly<{
  id: string;
  organizationId: string;
  email: string;
  userId: string | null;
  name: string | null;
  status: SeatRequestStatus;
  source: SeatRequestSource;
  idpRefused: boolean;
  idpKind: SignInIdpKind | null;
  salesNotifiedAt: number | null;
  openedAt: number;
  resolvedAt: number | null;
  resolvedByUserId: string | null;
}>;

/**
 * What opening found: a new row, a reopened one, one already open, one answered since, or (for
 * an open that only fills a gap) a row already on record, left as it is.
 */
export type SeatRequestOpened = Readonly<{
  request: SeatRequestRow;
  outcome: "opened" | "reopened" | "already_open" | "resolved_meanwhile" | "already_recorded";
}>;

/** The seat requests organization keeps, one row per organization and address. */
export abstract class SeatRequestRepository {
  /** Opens the request for this address, reusing the row; an open one only gains what is new. */
  abstract open(input: {
    id: string;
    organizationId: string;
    email: string;
    userId: string | null;
    name: string | null;
    source: SeatRequestSource;
    idpRefused: boolean;
    idpKind: SignInIdpKind | null;
    at: number;
    /** Only when the address has no row yet: an open or answered request is left untouched. */
    onlyIfAbsent?: boolean;
  }): Promise<SeatRequestOpened>;
  /** Every open request in the organization, oldest first. */
  abstract findOpen(input: { organizationId: string }): Promise<SeatRequestRow[]>;
  /** One open request; throws seat_request_not_found when absent or closed. */
  abstract getOpen(input: { organizationId: string; id: string }): Promise<SeatRequestRow>;
  /** Closes an open request; false when it was no longer open. */
  abstract resolve(input: {
    organizationId: string;
    id: string;
    status: "APPROVED" | "DECLINED";
    resolvedByUserId: string | null;
    at: number;
  }): Promise<boolean>;
  /** Reopens an approval whose seat could not be given; only the approval made at `at` by `by`. */
  abstract release(input: {
    organizationId: string;
    id: string;
    resolvedByUserId: string | null;
    at: number;
  }): Promise<void>;
  /** Marks the approval made at `at` as having given its seat. */
  abstract settleSeat(input: { organizationId: string; id: string; at: number }): Promise<void>;
  /** Approvals whose seat was still not given before `since`: their seat never landed. */
  abstract findSeatPending(input: {
    organizationId: string;
    since: number;
  }): Promise<SeatRequestRow[]>;
  /** Claims the one sales notice of this opening; false when it was claimed already. */
  abstract claimSalesNotice(input: { id: string; at: number }): Promise<boolean>;
  /** Every request naming this person, in any organization. */
  abstract findForUser(input: { userId: string }): Promise<SeatRequestRow[]>;
}
