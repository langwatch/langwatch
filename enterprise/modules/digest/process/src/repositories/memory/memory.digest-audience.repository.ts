// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  DigestAudienceRepository,
  DigestSettingsRecord,
} from "../digest-audience.repository.ts";

export class MemoryDigestAudienceRepository implements DigestAudienceRepository {
  static create(): MemoryDigestAudienceRepository {
    return new MemoryDigestAudienceRepository();
  }

  /** Each opted-out person, with the send their unsubscribe came from. */
  readonly #unsubscribed = new Map<string, string>();
  #settings: DigestSettingsRecord = { armed: false, lastPlannedWeek: null };

  private constructor() {}

  findUnsubscribed({ userIds }: { userIds: readonly string[] }): Promise<string[]> {
    return Promise.resolve(userIds.filter((userId) => this.#unsubscribed.has(userId)));
  }

  unsubscribe({ userId, sendId }: { userId: string; sendId: string; at: number }): Promise<void> {
    this.#unsubscribed.set(userId, sendId);
    return Promise.resolve();
  }

  resubscribe({ userId }: { userId: string }): Promise<void> {
    this.#unsubscribed.delete(userId);
    return Promise.resolve();
  }

  forgetUser({ userId }: { userId: string }): Promise<void> {
    this.#unsubscribed.delete(userId);
    return Promise.resolve();
  }

  /** Each standing opt-out, by person, with the send it came from. */
  unsubscribeSources(): ReadonlyMap<string, string> {
    return this.#unsubscribed;
  }

  getSettings(): Promise<DigestSettingsRecord> {
    return Promise.resolve(this.#settings);
  }

  setArmed({ armed }: { armed: boolean }): Promise<void> {
    this.#settings = { ...this.#settings, armed };
    return Promise.resolve();
  }

  markPlanned({ isoWeek }: { isoWeek: string }): Promise<void> {
    this.#settings = { ...this.#settings, lastPlannedWeek: isoWeek };
    return Promise.resolve();
  }
}
