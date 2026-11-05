// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Cloud's notices to self-hosted installs (self-hosted-notices.feature): one row per notice. */
import type { SelfHostedNoticeStatus } from "@langwatch/enterprise-licensing-contract";
import type { SelfHostedNoticeSeverity } from "@langwatch/ops-contract";
import type { Instant } from "@langwatch/time";

export type SelfHostedNoticeRecord = Readonly<{
  id: string;
  severity: SelfHostedNoticeSeverity;
  title: string;
  body: string;
  url: string | null;
  fixedIn: string | null;
  status: SelfHostedNoticeStatus;
  expiresAt: Instant | null;
  publishedAt: Instant | null;
  publishedBy: string | null;
  createdAt: Instant;
  updatedAt: Instant;
}>;

export abstract class SelfHostedNoticeRepository {
  abstract insert(row: SelfHostedNoticeRecord): Promise<void>;
  /** Writes every field of a notice already kept; an unknown id throws `not_found`. */
  abstract replace(row: SelfHostedNoticeRecord): Promise<void>;
  /** One notice; an unknown id throws `not_found`. */
  abstract getById(id: string): Promise<SelfHostedNoticeRecord>;
  /** Every notice, the newest written first. */
  abstract findAll(): Promise<SelfHostedNoticeRecord[]>;
  /** The published notices that have not expired at `at`, the newest published first. */
  abstract findAllSentAt(at: Instant): Promise<SelfHostedNoticeRecord[]>;
}
