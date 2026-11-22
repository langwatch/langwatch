// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { NotFoundError } from "@langwatch/handled-error";
import type { Instant } from "@langwatch/time";

import {
  type SelfHostedNoticeRecord,
  SelfHostedNoticeRepository,
} from "../self-hosted-notice.repository.ts";

/** The notices, held in this process. */
export class MemorySelfHostedNoticeRepository extends SelfHostedNoticeRepository {
  static create(): MemorySelfHostedNoticeRepository {
    return new MemorySelfHostedNoticeRepository();
  }

  readonly rows: SelfHostedNoticeRecord[] = [];

  private constructor() {
    super();
  }

  async insert(row: SelfHostedNoticeRecord): Promise<void> {
    this.rows.push(row);
  }

  async replace(row: SelfHostedNoticeRecord): Promise<void> {
    const index = this.rows.findIndex((held) => held.id === row.id);
    if (index === -1) throw selfHostedNoticeNotFound(row.id);
    this.rows[index] = row;
  }

  async getById(id: string): Promise<SelfHostedNoticeRecord> {
    const row = this.rows.find((held) => held.id === id);
    if (!row) throw selfHostedNoticeNotFound(id);
    return row;
  }

  async findAll(): Promise<SelfHostedNoticeRecord[]> {
    return this.rows.toSorted(
      (a, b) => b.createdAt.epochMilliseconds - a.createdAt.epochMilliseconds,
    );
  }

  async findAllSentAt(at: Instant): Promise<SelfHostedNoticeRecord[]> {
    return this.rows
      .filter(
        (row) =>
          row.status === "published" &&
          row.publishedAt !== null &&
          (row.expiresAt === null || row.expiresAt.epochMilliseconds > at.epochMilliseconds),
      )
      .toSorted(
        (a, b) => (b.publishedAt?.epochMilliseconds ?? 0) - (a.publishedAt?.epochMilliseconds ?? 0),
      );
  }
}

/** An id this store does not hold, as billing's rows answer it (`not_found`). */
function selfHostedNoticeNotFound(id: string): NotFoundError {
  return new NotFoundError("not_found", { resource: "Self-hosted notice", id });
}
