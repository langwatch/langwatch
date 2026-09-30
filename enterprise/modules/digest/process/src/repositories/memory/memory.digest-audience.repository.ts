// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { DigestUpdate } from "@langwatch/enterprise-digest-contract";

import type {
  DigestAudienceRepository,
  DigestSettingsRecord,
} from "../digest-audience.repository.ts";

export class MemoryDigestAudienceRepository implements DigestAudienceRepository {
  static create(): MemoryDigestAudienceRepository {
    return new MemoryDigestAudienceRepository();
  }

  readonly #enrolled = new Set<string>();
  readonly #unsubscribed = new Map<string, string>();
  readonly #updates = new Map<string, DigestUpdate>();
  #settings: DigestSettingsRecord = { armed: false, lastPlannedWeek: null };

  private constructor() {}

  listEnrolled(): Promise<string[]> {
    return Promise.resolve([...this.#enrolled]);
  }

  setEnrolled({
    organizationId,
    enrolled,
  }: {
    organizationId: string;
    enrolled: boolean;
    by: string;
  }): Promise<void> {
    if (enrolled) this.#enrolled.add(organizationId);
    else this.#enrolled.delete(organizationId);
    return Promise.resolve();
  }

  listUnsubscribed({ userIds }: { userIds: readonly string[] }): Promise<string[]> {
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

  listUnsubscribeSends(): Promise<string[]> {
    return Promise.resolve([...this.#unsubscribed.values()]);
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

  listUpdates(): Promise<DigestUpdate[]> {
    return Promise.resolve(
      [...this.#updates.values()].toSorted((left, right) =>
        right.isoWeek.localeCompare(left.isoWeek),
      ),
    );
  }

  saveUpdate({ by: _by, ...update }: DigestUpdate & { by: string }): Promise<void> {
    this.#updates.set(update.isoWeek, update);
    return Promise.resolve();
  }
}
