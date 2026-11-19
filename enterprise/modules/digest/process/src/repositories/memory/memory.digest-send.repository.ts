// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { DigestSendRecord, DigestSendRepository } from "../digest-send.repository.ts";

export class MemoryDigestSendRepository implements DigestSendRepository {
  static create(): MemoryDigestSendRepository {
    return new MemoryDigestSendRepository();
  }

  readonly #sends = new Map<string, DigestSendRecord>();

  private constructor() {}

  isSent({ userId, isoWeek }: { userId: string; isoWeek: string }): Promise<boolean> {
    return Promise.resolve(this.#sends.has(`${userId}:${isoWeek}`));
  }

  recordSent(record: DigestSendRecord): Promise<void> {
    const key = `${record.userId}:${record.isoWeek}`;
    if (!this.#sends.has(key)) this.#sends.set(key, record);
    return Promise.resolve();
  }
}
