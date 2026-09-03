import { createLogger } from "@langwatch/observability";
import {
  ScenarioTabRegistry,
  type ScenarioTabRegistration,
} from "@langwatch/scenario-contract";
import type { ScenarioClockPort } from "../ports/scenario-clock.port";
import type { ScenarioTabStorePort } from "../ports/scenario-tab-store.port";

const logger = createLogger("langwatch:scenario-tab-registry");
const KEY_PREFIX = "scenario_tab:v1";

export const SCENARIO_TAB_TTL_SECONDS = 30;
export const SCENARIO_TAB_DISCONNECT_GRACE_SECONDS = 5;
export const SCENARIO_TAB_PENDING_TTL_SECONDS = 20;

type PendingNavigate = { url: string; expiresAt: number };

export class ScenarioTabRegistryService extends ScenarioTabRegistry {
  private readonly memoryTabs = new Map<string, Map<string, number>>();
  private readonly memoryPending = new Map<string, PendingNavigate>();

  static create(options: {
    store: ScenarioTabStorePort | null;
    clock: ScenarioClockPort;
  }): ScenarioTabRegistryService {
    return new ScenarioTabRegistryService(options);
  }

  private constructor(
    private readonly options: {
      store: ScenarioTabStorePort | null;
      clock: ScenarioClockPort;
    },
  ) {
    super();
  }

  async register(input: ScenarioTabRegistration): Promise<void> {
    const key = ScenarioTabRegistryService.tabSetKey(input.projectId, input.tabKey);
    const now = input.now ?? this.options.clock.now().getTime();
    const store = this.options.store;
    if (!store) {
      const entry = this.memoryEntry(key);
      entry.set(input.tabId, now);
      this.pruneMemory(key, entry, now);
      return;
    }

    await this.swallowStoreFailure(input.projectId, "register", () =>
      store.refresh({
        key,
        member: input.tabId,
        score: now,
        ttlSeconds: SCENARIO_TAB_TTL_SECONDS,
      }),
    );
  }

  async unregister(input: ScenarioTabRegistration): Promise<void> {
    const key = ScenarioTabRegistryService.tabSetKey(input.projectId, input.tabKey);
    const now = input.now ?? this.options.clock.now().getTime();
    const retiredScore =
      now - (SCENARIO_TAB_TTL_SECONDS - SCENARIO_TAB_DISCONNECT_GRACE_SECONDS) * 1000;
    const store = this.options.store;
    if (!store) {
      const entry = this.memoryTabs.get(key);
      const current = entry?.get(input.tabId);
      if (current !== undefined && retiredScore < current) {
        entry?.set(input.tabId, retiredScore);
      }
      return;
    }

    await this.swallowStoreFailure(input.projectId, "retire", () =>
      store.retire({ key, member: input.tabId, score: retiredScore }),
    );
  }

  async hasLiveTab(input: {
    projectId: string;
    tabKey: string;
    now?: number;
  }): Promise<boolean> {
    const key = ScenarioTabRegistryService.tabSetKey(input.projectId, input.tabKey);
    const now = input.now ?? this.options.clock.now().getTime();
    const cutoff = now - SCENARIO_TAB_TTL_SECONDS * 1000;
    const store = this.options.store;
    if (!store) {
      const entry = this.memoryTabs.get(key);
      if (!entry) {
        return false;
      }
      this.pruneMemory(key, entry, now);
      return entry.size > 0;
    }

    try {
      return (await store.countAfter({ key, cutoff })) > 0;
    } catch (error) {
      logger.warn({ error, projectId: input.projectId }, "Failed to read Scenario tab");
      return false;
    }
  }

  async setPendingNavigate(input: {
    projectId: string;
    tabKey: string;
    url: string;
    now?: number;
  }): Promise<void> {
    const key = ScenarioTabRegistryService.pendingKey(input.projectId, input.tabKey);
    const now = input.now ?? this.options.clock.now().getTime();
    const store = this.options.store;
    if (!store) {
      this.prunePendingMemory(now);
      this.memoryPending.set(key, {
        url: input.url,
        expiresAt: now + SCENARIO_TAB_PENDING_TTL_SECONDS * 1000,
      });
      return;
    }

    await this.swallowStoreFailure(input.projectId, "park", () =>
      store.setPending({
        key,
        url: input.url,
        ttlSeconds: SCENARIO_TAB_PENDING_TTL_SECONDS,
      }),
    );
  }

  async tryTakePendingNavigate(input: {
    projectId: string;
    tabKey: string;
    now?: number;
  }): Promise<string | null> {
    const key = ScenarioTabRegistryService.pendingKey(input.projectId, input.tabKey);
    const now = input.now ?? this.options.clock.now().getTime();
    const store = this.options.store;
    if (!store) {
      const entry = this.memoryPending.get(key);
      this.memoryPending.delete(key);
      return entry && entry.expiresAt > now ? entry.url : null;
    }

    try {
      return await store.tryTakePending(key);
    } catch (error) {
      logger.warn(
        { error, projectId: input.projectId },
        "Failed to read parked Scenario tab handoff",
      );
      return null;
    }
  }

  private memoryEntry(key: string): Map<string, number> {
    const existing = this.memoryTabs.get(key);
    if (existing) {
      return existing;
    }
    const entry = new Map<string, number>();
    this.memoryTabs.set(key, entry);
    return entry;
  }

  private pruneMemory(key: string, entry: Map<string, number>, now: number): void {
    const cutoff = now - SCENARIO_TAB_TTL_SECONDS * 1000;
    for (const [tabId, seenAt] of entry) {
      if (seenAt < cutoff) {
        entry.delete(tabId);
      }
    }
    if (entry.size === 0) {
      this.memoryTabs.delete(key);
    }
  }

  private prunePendingMemory(now: number): void {
    for (const [key, entry] of this.memoryPending) {
      if (entry.expiresAt <= now) {
        this.memoryPending.delete(key);
      }
    }
  }

  private async swallowStoreFailure(
    projectId: string,
    operation: string,
    run: () => Promise<void>,
  ): Promise<void> {
    try {
      await run();
    } catch (error) {
      logger.warn({ error, projectId, operation }, "Scenario tab store failed");
    }
  }

  static pendingKey(projectId: string, tabKey: string): string {
    return `${KEY_PREFIX}:pending:${projectId}:${tabKey}`;
  }

  private static tabSetKey(projectId: string, tabKey: string): string {
    return `${KEY_PREFIX}:${projectId}:${tabKey}`;
  }
}
