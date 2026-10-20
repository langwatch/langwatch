import { nowInstant } from "@langwatch/time";

import {
  confirmCardKey,
  confirmClaimKey,
  confirmGrantKey,
  confirmKeyBindingKey,
  confirmRaiseKey,
  type ConfirmTarget,
} from "../../rules/langy-local-control-keys.rules.ts";
import {
  LangyDeleteConfirmationRepository,
  type ConfirmKeyBinding,
} from "../langy-delete-confirmation.repository.ts";
import type { LocalRecordLookup } from "../langy-local-call.repository.ts";

/** The confirmation records in one map, for a process without Redis; expiry is read on access. */
export class LangyDeleteConfirmationMemoryRepository extends LangyDeleteConfirmationRepository {
  readonly #now: () => number;
  readonly #values = new Map<string, { value: string; expiresAt: number }>();

  private constructor(now: () => number) {
    super();
    this.#now = now;
  }

  static create({
    now = () => nowInstant().epochMilliseconds,
  }: { now?: () => number } = {}): LangyDeleteConfirmationMemoryRepository {
    return new LangyDeleteConfirmationMemoryRepository(now);
  }

  async saveKeyBinding({
    apiKeyId,
    binding,
    ttlSeconds,
  }: {
    apiKeyId: string;
    binding: ConfirmKeyBinding;
    ttlSeconds: number;
  }): Promise<void> {
    this.#set(confirmKeyBindingKey(apiKeyId), JSON.stringify(binding), ttlSeconds);
  }

  async lookupKeyBinding(apiKeyId: string): Promise<LocalRecordLookup<ConfirmKeyBinding>> {
    const raw = this.#get(confirmKeyBindingKey(apiKeyId));
    return raw === undefined
      ? { kind: "miss" }
      : { kind: "hit", value: JSON.parse(raw) as ConfirmKeyBinding };
  }

  async saveGrant({
    target,
    ttlSeconds,
  }: {
    target: ConfirmTarget;
    ttlSeconds: number;
  }): Promise<void> {
    this.#set(confirmGrantKey(target), "1", ttlSeconds);
  }

  async hasGrant(target: ConfirmTarget): Promise<boolean> {
    return this.#get(confirmGrantKey(target)) !== undefined;
  }

  async consumeGrants(targets: readonly ConfirmTarget[]): Promise<boolean> {
    const keys = targets.map(confirmGrantKey);
    if (keys.length === 0 || !keys.every((key) => this.#get(key) !== undefined)) return false;
    for (const key of keys) this.#values.delete(key);
    return true;
  }

  async savePendingCard({
    target,
    waitId,
    ttlSeconds,
  }: {
    target: ConfirmTarget;
    waitId: string;
    ttlSeconds: number;
  }): Promise<void> {
    this.#set(confirmCardKey(target), waitId, ttlSeconds);
  }

  async claimCardRaise({
    target,
    ttlSeconds,
  }: {
    target: ConfirmTarget;
    ttlSeconds: number;
  }): Promise<boolean> {
    const key = confirmRaiseKey(target);
    if (this.#get(key) !== undefined) return false;
    this.#set(key, "1", ttlSeconds);
    return true;
  }

  async releaseCardRaise(target: ConfirmTarget): Promise<void> {
    this.#values.delete(confirmRaiseKey(target));
  }

  async lookupPendingCard(target: ConfirmTarget): Promise<LocalRecordLookup<string>> {
    const waitId = this.#get(confirmCardKey(target));
    return waitId === undefined ? { kind: "miss" } : { kind: "hit", value: waitId };
  }

  async claimCard({
    waitId,
    ttlSeconds,
  }: {
    waitId: string;
    ttlSeconds: number;
  }): Promise<boolean> {
    const key = confirmClaimKey(waitId);
    if (this.#get(key) !== undefined) return false;
    this.#set(key, "1", ttlSeconds);
    return true;
  }

  #set(key: string, value: string, ttlSeconds: number): void {
    this.#values.set(key, { value, expiresAt: this.#now() + ttlSeconds * 1000 });
  }

  #get(key: string): string | undefined {
    const held = this.#values.get(key);
    if (!held) return undefined;
    if (held.expiresAt <= this.#now()) {
      this.#values.delete(key);
      return undefined;
    }
    return held.value;
  }
}
