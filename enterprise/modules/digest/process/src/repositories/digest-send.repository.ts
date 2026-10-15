// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { DigestTemplateId } from "@langwatch/enterprise-digest-contract";

export type DigestSendRecord = Readonly<{
  id: string;
  userId: string;
  organizationId: string;
  isoWeek: string;
  templateId: DigestTemplateId;
  /** `{ linkKey: url }`; a click token names only the key. */
  links: Readonly<Record<string, string>>;
  sentAt: number | null;
}>;

export type DigestClickRecord = Readonly<{ sendId: string; linkKey: string }>;

export interface DigestSendRepository {
  /** This person's row for the week: the one written now, or the one a redelivery finds. */
  claim(input: Omit<DigestSendRecord, "sentAt">): Promise<DigestSendRecord>;
  findById(input: { id: string }): Promise<DigestSendRecord[]>;
  markSent(input: { id: string; sentAt: number }): Promise<void>;
  recordClick(input: { id: string; sendId: string; linkKey: string; at: number }): Promise<void>;
  listSince(input: { isoWeek: string }): Promise<DigestSendRecord[]>;
  listClicks(input: { sendIds: readonly string[] }): Promise<DigestClickRecord[]>;
}
