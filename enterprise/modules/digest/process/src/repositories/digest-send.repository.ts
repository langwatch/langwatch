// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { DigestTemplateId } from "@langwatch/enterprise-digest-contract";

/** One person's email for one week of one organization, claimed just before it is handed to our own mailer. */
export type DigestSendRecord = Readonly<{
  userId: string;
  organizationId: string;
  isoWeek: string;
  templateId: DigestTemplateId;
  sentAt: number;
}>;

export interface DigestSendRepository {
  isSent(input: { userId: string; organizationId: string; isoWeek: string }): Promise<boolean>;
  /**
   * Takes the person's week in the organization, once: true for the one caller whose row was written, false for
   * every caller after it. Only the claimer sends, so a retry never mails a second time.
   */
  claim(input: DigestSendRecord): Promise<boolean>;
  /** Deletes every week's send row naming the person, in every organization. */
  forgetUser(input: { userId: string }): Promise<void>;
}
