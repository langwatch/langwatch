import { nowInstant } from "@langwatch/time";

import {
  type LangyUiActionPendingRead,
  LangyUiActionRepository,
  type LangyUiActionResultWait,
  type PendingUiAction,
} from "../langy-ui-action.repository.ts";
import type { LangyMemoryStore } from "./langy-memory.store.ts";

const POLL_MS = 5;

function now(): number {
  return nowInstant().epochMilliseconds;
}

/** The Redis channel's memory twin: the same TTLs, first-claim-wins and newest-first pops. */
export class MemoryLangyUiActionRepository extends LangyUiActionRepository {
  static create(store: LangyMemoryStore): MemoryLangyUiActionRepository {
    return new MemoryLangyUiActionRepository(store);
  }

  private constructor(private readonly store: LangyMemoryStore) {
    super();
  }

  async publishPending(input: {
    actionId: string;
    pending: PendingUiAction;
    ttlSeconds: number;
  }): Promise<void> {
    this.store.uiActionPending.set(input.actionId, {
      value: { ...input.pending },
      expiresAt: now() + input.ttlSeconds * 1000,
    });
  }

  async readPending(actionId: string): Promise<LangyUiActionPendingRead> {
    const held = this.store.uiActionPending.get(actionId);
    if (!held || held.expiresAt <= now()) return { kind: "miss" };
    return { kind: "hit", pending: { ...held.value } };
  }

  async dropPending(actionId: string): Promise<void> {
    this.store.uiActionPending.delete(actionId);
  }

  async claim(input: {
    actionId: string;
    claimant: string;
    ttlSeconds: number;
  }): Promise<{ isClaimed: boolean }> {
    const held = this.store.uiActionClaims.get(input.actionId);
    if (held && held.expiresAt > now()) return { isClaimed: false };
    this.store.uiActionClaims.set(input.actionId, {
      value: input.claimant,
      expiresAt: now() + input.ttlSeconds * 1000,
    });
    return { isClaimed: true };
  }

  async isClaimedBy(input: { actionId: string; claimant: string }): Promise<boolean> {
    const held = this.store.uiActionClaims.get(input.actionId);
    return held !== undefined && held.expiresAt > now() && held.value === input.claimant;
  }

  async pushResult(input: { actionId: string; raw: string; ttlSeconds: number }): Promise<void> {
    const held = this.store.uiActionResults.get(input.actionId);
    const values = held && held.expiresAt > now() ? held.value : [];
    values.unshift(input.raw);
    this.store.uiActionResults.set(input.actionId, {
      value: values,
      expiresAt: now() + input.ttlSeconds * 1000,
    });
  }

  openResultWait(): LangyUiActionResultWait {
    return {
      next: async ({ actionId, timeoutSeconds }) => {
        const deadline = now() + timeoutSeconds * 1000;
        while (now() < deadline) {
          const raw = this.pop(actionId);
          if (raw !== undefined) return { kind: "result", raw };
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
        const raw = this.pop(actionId);
        return raw === undefined ? { kind: "timeout" } : { kind: "result", raw };
      },
      release: () => undefined,
    };
  }

  private pop(actionId: string): string | undefined {
    const held = this.store.uiActionResults.get(actionId);
    if (!held || held.expiresAt <= now()) return undefined;
    return held.value.shift();
  }
}
