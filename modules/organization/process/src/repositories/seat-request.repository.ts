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

/** What opening found: a new row, a reopened one, one already open, or one answered since. */
export type SeatRequestOpened = Readonly<{
  request: SeatRequestRow;
  outcome: "opened" | "reopened" | "already_open" | "resolved_meanwhile";
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
  /** Claims the one sales notice of this opening; false when it was claimed already. */
  abstract claimSalesNotice(input: { id: string; at: number }): Promise<boolean>;
  /** Every request naming this person, in any organization. */
  abstract findForUser(input: { userId: string }): Promise<SeatRequestRow[]>;
}
