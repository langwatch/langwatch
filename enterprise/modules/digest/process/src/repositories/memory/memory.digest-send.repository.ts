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

  claim(record: DigestSendRecord): Promise<boolean> {
    const key = `${record.userId}:${record.isoWeek}`;
    if (this.#sends.has(key)) return Promise.resolve(false);
    this.#sends.set(key, record);
    return Promise.resolve(true);
  }
}
