/**
 * A worker hands a module dependencies whose calls mark the running outbox delivery's progress.
 * Spec: packages/process/specs/module-members.feature
 */
import { runDeliveryMarkingProgress } from "@langwatch/eventing";
import { moduleApi } from "@langwatch/module";
import { memoryStores } from "@langwatch/process-stores";
import { describe, expect, it, vi } from "vitest";

import { bootInstalledProcess } from "../boot-installed-process.ts";
import { defineProcessModule, type FeatureSetup, type ServerRole } from "../feature-installer.ts";
import { defineRepositories } from "../repository-registry.ts";
import { testPeer } from "../testing.ts";

class Ledger {
  readonly #entries: string[] = [];

  async record(entry: string): Promise<number> {
    this.#entries.push(entry);
    return this.#entries.length;
  }
}

class LedgerRepositories {
  static readonly requires = [] as const;
  static create(): { ledger: Ledger } {
    return { ledger: new Ledger() };
  }
}

interface ClockApi {
  tick(): Promise<string>;
}
const ClockApi = moduleApi<ClockApi>()("project");

interface LedgerApi {
  record(entry: string): Promise<number>;
  tick(): Promise<string>;
}
const LedgerApi = moduleApi<LedgerApi>()("dataset");

class LedgerModule {
  static readonly contract = LedgerApi;
  static readonly dependencies = { clock: ClockApi };
  static create({
    repositories,
    dependencies,
  }: FeatureSetup<{ clock: typeof ClockApi }, undefined, { ledger: Ledger }>): LedgerApi {
    return {
      record: (entry) => repositories.ledger.record(entry),
      tick: () => dependencies.clock.tick(),
    };
  }
}

const ledger = defineProcessModule("dataset")
  .withRepositories(defineRepositories({ live: LedgerRepositories, memory: LedgerRepositories }))
  .withApi(LedgerModule)
  .withTransports();

async function bootLedger(role: ServerRole) {
  const runtime = await bootInstalledProcess({
    role,
    modules: [ledger],
    config: {},
    stores: memoryStores(),
    peers: [testPeer({ token: ClockApi, instance: { tick: () => Promise.resolve("tock") } })],
  });
  return { runtime, app: runtime.module(ledger).provided };
}

describe("dependencies handed to a module", () => {
  describe("when a worker's module calls its repository inside an outbox delivery", () => {
    /** @scenario "A worker's module dependencies mark the running delivery's progress" */
    it("marks that delivery's progress when the call starts and when it settles", async () => {
      const { runtime, app } = await bootLedger("worker");
      const markProgress = vi.fn();

      try {
        const count = await runDeliveryMarkingProgress({
          markProgress,
          run: () => app.record("first"),
        });

        expect(count).toBe(1);
        expect(markProgress).toHaveBeenCalledTimes(2);
      } finally {
        await runtime.stop();
      }
    });

    /** @scenario "A worker's module dependencies mark the running delivery's progress" */
    it("marks it for a call to a peer module's Api as well", async () => {
      const { runtime, app } = await bootLedger("worker");
      const markProgress = vi.fn();

      try {
        await runDeliveryMarkingProgress({ markProgress, run: () => app.tick() });

        expect(markProgress).toHaveBeenCalledTimes(2);
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when the module calls its repository outside any delivery", () => {
    /** @scenario "A worker's module dependencies mark the running delivery's progress" */
    it("passes the call straight through", async () => {
      const { runtime, app } = await bootLedger("worker");

      try {
        await expect(app.record("first")).resolves.toBe(1);
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when the module boots in the api role, which runs no deliveries", () => {
    /** @scenario "A worker's module dependencies mark the running delivery's progress" */
    it("hands the module its repository itself, untracked", async () => {
      const { runtime, app } = await bootLedger("api");
      const markProgress = vi.fn();

      try {
        await runDeliveryMarkingProgress({ markProgress, run: () => app.record("first") });

        expect(markProgress).not.toHaveBeenCalled();
      } finally {
        await runtime.stop();
      }
    });
  });
});
