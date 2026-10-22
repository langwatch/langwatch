// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** How a kept notice reads to Cloud admin, and how it travels to an install. */
import type { SelfHostedNoticeView } from "@langwatch/enterprise-licensing-contract";
import type { SelfHostedNotice } from "@langwatch/ops-contract";
import type { Instant } from "@langwatch/time";

import type { SelfHostedNoticeRecord } from "../repositories/self-hosted-notice.repository.ts";

export function selfHostedNoticeView(row: SelfHostedNoticeRecord): SelfHostedNoticeView {
  return {
    id: row.id,
    severity: row.severity,
    title: row.title,
    body: row.body,
    url: row.url,
    fixedIn: row.fixedIn,
    status: row.status,
    expiresAt: row.expiresAt === null ? null : iso(row.expiresAt),
    publishedAt: row.publishedAt === null ? null : iso(row.publishedAt),
    publishedBy: row.publishedBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/** The install's wire; a notice never published has no publication time to send, so is none. */
export function selfHostedNoticeWire(row: SelfHostedNoticeRecord): SelfHostedNotice[] {
  if (row.publishedAt === null) return [];
  return [
    {
      id: row.id,
      severity: row.severity,
      title: row.title,
      body: row.body,
      url: row.url,
      fixed_in: row.fixedIn,
      published_at: iso(row.publishedAt),
    },
  ];
}

function iso(at: Instant): string {
  return at.toString({ fractionalSecondDigits: 3 });
}
