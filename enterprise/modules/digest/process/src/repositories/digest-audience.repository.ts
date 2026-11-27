// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

export type DigestSettingsRecord = Readonly<{ armed: boolean; lastPlannedWeek: string | null }>;

/** Who is sent to: the enrolled cohort, the members who opted out, and the switch. */
export interface DigestAudienceRepository {
  findEnrolled(): Promise<string[]>;
  setEnrolled(input: { organizationId: string; enrolled: boolean; by: string }): Promise<void>;
  /** The subset of these people who opted out of the digest. */
  findUnsubscribed(input: { userIds: readonly string[] }): Promise<string[]>;
  /** Opts the person out, recording the send whose link they used. */
  unsubscribe(input: { userId: string; sendId: string; at: number }): Promise<void>;
  resubscribe(input: { userId: string }): Promise<void>;
  /** Deletes the person's subscription row; a second call finds nothing and changes nothing. */
  forgetUser(input: { userId: string }): Promise<void>;
  getSettings(): Promise<DigestSettingsRecord>;
  setArmed(input: { armed: boolean }): Promise<void>;
  markPlanned(input: { isoWeek: string }): Promise<void>;
}
