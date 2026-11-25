import type { TakenPendingNavigate } from "@langwatch/scenario-contract";

import type { ScenarioTabStore } from "../../app/scenario.app.ts";

/** The Redis tab store's sorted sets and parked navigates, held in memory. Nothing expires. */
export class MemoryScenarioTabStoreRepository implements ScenarioTabStore {
  private readonly tabs = new Map<string, Map<string, number>>();
  private readonly pending = new Map<string, string>();

  static create(): MemoryScenarioTabStoreRepository {
    return new MemoryScenarioTabStoreRepository();
  }

  private constructor() {}

  refresh(input: {
    key: string;
    member: string;
    score: number;
    ttlSeconds: number;
  }): Promise<void> {
    const members = this.tabs.get(input.key) ?? new Map<string, number>();
    members.set(input.member, input.score);
    this.tabs.set(input.key, members);
    return Promise.resolve();
  }

  retire(input: { key: string; member: string; score: number }): Promise<void> {
    const members = this.tabs.get(input.key);
    const current = members?.get(input.member);
    if (members && current !== undefined && input.score < current) {
      members.set(input.member, input.score);
    }
    return Promise.resolve();
  }

  countAfter(input: { key: string; cutoff: number }): Promise<number> {
    const members = this.tabs.get(input.key);
    if (!members) return Promise.resolve(0);
    for (const [member, score] of members) {
      if (score <= input.cutoff) members.delete(member);
    }
    return Promise.resolve(members.size);
  }

  setPending(input: { key: string; url: string; ttlSeconds: number }): Promise<void> {
    this.pending.set(input.key, input.url);
    return Promise.resolve();
  }

  takePending(key: string): Promise<TakenPendingNavigate> {
    const url = this.pending.get(key);
    this.pending.delete(key);
    return Promise.resolve(url ? { taken: true, url } : { taken: false });
  }
}
