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
 * The mail log for seat requests and refused sign-ins (ruling R5): at most one row per
 * organization, kind, address and UTC day.
 */
export abstract class OrganizationAccessNoticeRepository {
  /**
   * Records the notice; an empty answer means this person was noticed already today. A row from
   * earlier today that was never mailed comes back, so a later arrival retries its mail.
   */
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
  /** Marks notices mailed, once each: answers the ids this call marked. */
  abstract markMailed(input: { ids: readonly string[]; at: number }): Promise<string[]>;
  /** How many notices about refused sign-ins the organization recorded that UTC day. */
  abstract countRefusedForDay(input: { organizationId: string; dayKey: string }): Promise<number>;
  /** Clears the mailed mark of a notice whose mail never reached the mailer. */
  abstract releaseMailed(input: { id: string }): Promise<void>;
}
