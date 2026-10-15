// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  DigestClickRecord,
  DigestSendRecord,
  DigestSendRepository,
} from "../digest-send.repository.ts";

export class MemoryDigestSendRepository implements DigestSendRepository {
  static create(): MemoryDigestSendRepository {
    return new MemoryDigestSendRepository();
  }

  readonly #sends = new Map<string, DigestSendRecord>();
  readonly #clicks: DigestClickRecord[] = [];

  private constructor() {}

  claim(input: Omit<DigestSendRecord, "sentAt">): Promise<DigestSendRecord> {
    const existing = [...this.#sends.values()].find(
      (send) => send.userId === input.userId && send.isoWeek === input.isoWeek,
    );
    if (existing) return Promise.resolve(existing);
    const created = { ...input, sentAt: null };
    this.#sends.set(input.id, created);
    return Promise.resolve(created);
  }

  findById({ id }: { id: string }): Promise<DigestSendRecord[]> {
    const send = this.#sends.get(id);
    return Promise.resolve(send ? [send] : []);
  }

  markSent({ id, sentAt }: { id: string; sentAt: number }): Promise<void> {
    const send = this.#sends.get(id);
    if (send) this.#sends.set(id, { ...send, sentAt });
    return Promise.resolve();
  }

  recordClick({ sendId, linkKey }: { id: string; sendId: string; linkKey: string }): Promise<void> {
    this.#clicks.push({ sendId, linkKey });
    return Promise.resolve();
  }

  listSince({ isoWeek }: { isoWeek: string }): Promise<DigestSendRecord[]> {
    return Promise.resolve([...this.#sends.values()].filter((send) => send.isoWeek >= isoWeek));
  }

  listClicks({ sendIds }: { sendIds: readonly string[] }): Promise<DigestClickRecord[]> {
    return Promise.resolve(this.#clicks.filter((click) => sendIds.includes(click.sendId)));
  }
}
