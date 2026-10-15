// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { DigestUpdate } from "@langwatch/enterprise-digest-contract";

export type DigestSettingsRecord = Readonly<{ armed: boolean; lastPlannedWeek: string | null }>;

/** Who is sent to: the enrolled cohort, the unsubscribed, the switch, and the week's card. */
export interface DigestAudienceRepository {
  listEnrolled(): Promise<string[]>;
  setEnrolled(input: { organizationId: string; enrolled: boolean; by: string }): Promise<void>;
  /** The subset of these people who unsubscribed. */
  listUnsubscribed(input: { userIds: readonly string[] }): Promise<string[]>;
  unsubscribe(input: { userId: string; sendId: string; at: number }): Promise<void>;
  resubscribe(input: { userId: string }): Promise<void>;
  /** The send each standing unsubscribe came from. */
  listUnsubscribeSends(): Promise<string[]>;
  getSettings(): Promise<DigestSettingsRecord>;
  setArmed(input: { armed: boolean }): Promise<void>;
  markPlanned(input: { isoWeek: string }): Promise<void>;
  /** Newest week first. */
  listUpdates(): Promise<DigestUpdate[]>;
  saveUpdate(input: DigestUpdate & { by: string }): Promise<void>;
}
