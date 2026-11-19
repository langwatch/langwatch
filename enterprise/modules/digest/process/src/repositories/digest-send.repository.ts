// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { DigestTemplateId } from "@langwatch/enterprise-digest-contract";

/** One person's email for one week, as our own mailer accepted it. */
export type DigestSendRecord = Readonly<{
  userId: string;
  organizationId: string;
  isoWeek: string;
  templateId: DigestTemplateId;
  sentAt: number;
}>;

export interface DigestSendRepository {
  isSent(input: { userId: string; isoWeek: string }): Promise<boolean>;
  /** Once per person and week: a second record of the same week changes nothing. */
  recordSent(input: DigestSendRecord): Promise<void>;
}
