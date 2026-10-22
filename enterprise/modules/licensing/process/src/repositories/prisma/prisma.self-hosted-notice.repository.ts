import {
  SELF_HOSTED_NOTICE_STATUSES,
  type SelfHostedNoticeStatus,
} from "@langwatch/enterprise-licensing-contract";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { NotFoundError } from "@langwatch/handled-error";
import {
  SELF_HOSTED_NOTICE_SEVERITIES,
  type SelfHostedNoticeSeverity,
} from "@langwatch/ops-contract";
import type { PrismaClient, SelfHostedNotice } from "@langwatch/prisma-client/generated";
import { prismaTables } from "@langwatch/prisma-client/ownership";
import { fromDate, toDate, type Instant } from "@langwatch/time";

import {
  type SelfHostedNoticeRecord,
  SelfHostedNoticeRepository,
} from "../self-hosted-notice.repository.ts";

type SelfHostedNoticeDatabase = Pick<PrismaClient, "selfHostedNotice">;

/** The notices Cloud admin writes; read on every usage report Cloud answers. */
export class PrismaSelfHostedNoticeRepository extends SelfHostedNoticeRepository {
  static readonly tables = prismaTables("SelfHostedNotice");

  static create(prisma: SelfHostedNoticeDatabase): PrismaSelfHostedNoticeRepository {
    return new PrismaSelfHostedNoticeRepository(prisma);
  }

  private constructor(private readonly prisma: SelfHostedNoticeDatabase) {
    super();
  }

  async insert(row: SelfHostedNoticeRecord): Promise<void> {
    await this.prisma.selfHostedNotice.create({ data: columnsOf(row) });
  }

  async replace(row: SelfHostedNoticeRecord): Promise<void> {
    const { count } = await this.prisma.selfHostedNotice.updateMany({
      where: { id: row.id },
      data: columnsOf(row),
    });
    if (count === 0) throw selfHostedNoticeNotFound(row.id);
  }

  async getById(id: string): Promise<SelfHostedNoticeRecord> {
    const row = await this.prisma.selfHostedNotice.findUnique({ where: { id } });
    if (!row) throw selfHostedNoticeNotFound(id);
    return recordOf(row);
  }

  async findAll(): Promise<SelfHostedNoticeRecord[]> {
    const rows = await this.prisma.selfHostedNotice.findMany({ orderBy: { createdAt: "desc" } });
    return rows.map(recordOf);
  }

  async findAllSentAt(at: Instant): Promise<SelfHostedNoticeRecord[]> {
    const rows = await this.prisma.selfHostedNotice.findMany({
      where: {
        status: "published",
        publishedAt: { not: null },
        OR: [{ expiresAt: null }, { expiresAt: { gt: toDate(at) } }],
      },
      orderBy: { publishedAt: "desc" },
    });
    return rows.map(recordOf);
  }
}

function columnsOf(row: SelfHostedNoticeRecord) {
  return {
    ...row,
    expiresAt: row.expiresAt === null ? null : toDate(row.expiresAt),
    publishedAt: row.publishedAt === null ? null : toDate(row.publishedAt),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

function recordOf(row: SelfHostedNotice): SelfHostedNoticeRecord {
  return {
    id: row.id,
    severity: oneOf(SELF_HOSTED_NOTICE_SEVERITIES, row.severity, "info"),
    title: row.title,
    body: row.body,
    url: row.url,
    fixedIn: row.fixedIn,
    status: oneOf(SELF_HOSTED_NOTICE_STATUSES, row.status, "draft"),
    expiresAt: row.expiresAt === null ? null : fromDate(row.expiresAt),
    publishedAt: row.publishedAt === null ? null : fromDate(row.publishedAt),
    publishedBy: row.publishedBy,
    createdAt: fromDate(row.createdAt),
    updatedAt: fromDate(row.updatedAt),
  };
}

/** A column value as one of its known words; anything else reads as the safest one. */
function oneOf<T extends SelfHostedNoticeSeverity | SelfHostedNoticeStatus>(
  words: readonly T[],
  value: string,
  fallback: T,
): T {
  return words.find((word) => word === value) ?? fallback;
}

/** An id this store does not hold, as billing's rows answer it (`not_found`). */
function selfHostedNoticeNotFound(id: string): NotFoundError {
  return new NotFoundError("not_found", { resource: "Self-hosted notice", id });
}
