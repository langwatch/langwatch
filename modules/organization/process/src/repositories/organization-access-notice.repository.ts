/** The two things an access notice tells administrators about. */
export type AccessNoticeKind = "seat_request" | "idp_refused";

/** One notice in the outbox; timestamps are epoch milliseconds. */
export type AccessNoticeRow = Readonly<{
  id: string;
  organizationId: string;
  kind: AccessNoticeKind;
  email: string;
  name: string | null;
  idp: string | null;
  idpRefused: boolean;
  dayKey: string;
  createdAt: number;
  mailedAt: number | null;
}>;

/**
 * The mail outbox for seat requests and refused sign-ins (ruling R5): at most one row per
 * organization, kind, address and UTC day; held rows wait for the organization's digest.
 */
export abstract class OrganizationAccessNoticeRepository {
  /** Records the notice; an empty answer means this person was noticed already today. */
  abstract record(input: {
    id: string;
    organizationId: string;
    kind: AccessNoticeKind;
    email: string;
    name: string | null;
    idp: string | null;
    idpRefused: boolean;
    dayKey: string;
    at: number;
  }): Promise<AccessNoticeRow[]>;
  /** When the organization was last mailed a notice or digest; null when never. */
  abstract getMailWindow(input: {
    organizationId: string;
  }): Promise<{ lastMailedAt: number | null }>;
  /** Marks notices mailed, once each: answers the ids this call marked. */
  abstract markMailed(input: {
    ids: readonly string[];
    delivery: "immediate" | "digest";
    at: number;
  }): Promise<string[]>;
  /** Notices held for the organization's digest, oldest first. */
  abstract findHeld(input: { organizationId: string }): Promise<AccessNoticeRow[]>;
  /** Organizations with at least one held notice. */
  abstract findOrganizationsWithHeld(): Promise<string[]>;
}
