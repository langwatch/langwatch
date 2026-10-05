/**
 * Spec: specs/server/typed-process-supply.feature,
 * "stores are built from the deployment's own configuration".
 */
import { moduleApi } from "@langwatch/module";
import { memoryStores } from "@langwatch/process-stores";
import { describe, expect, it } from "vitest";

import { bootInstalledProcess } from "../src/boot-installed-process.ts";
import { processConfig } from "../src/config.ts";
import { defineProcessModule, type FeatureSetup } from "../src/feature-installer.ts";
import { defineRepositories } from "../src/repository-registry.ts";
import { Server } from "../src/server-factory.ts";

interface LedgerApi {
  total(): number;
}
const LedgerApi = moduleApi<LedgerApi>()("annotation");

/** Every repository built, by tier, so a test can say none was. */
const built: string[] = [];

class LiveRepositories {
  static readonly requires = ["prisma"] as const;

  static create({ prisma }: { prisma: unknown }) {
    built.push(prisma ? "live" : "live without a client");
    return { entries: { count: () => (prisma ? 1 : 0) } };
  }
}

class MemoryRepositories {
  static readonly requires = [] as const;

  static create() {
    built.push("memory");
    return { entries: { count: () => 0 } };
  }
}

class LedgerApp implements LedgerApi {
  static readonly contract = LedgerApi;
  static readonly dependencies = {};

  private constructor(private readonly entries: { count(): number }) {}

  static create({
    repositories,
  }: FeatureSetup<{}, unknown, undefined, { entries: { count(): number } }>): LedgerApp {
    return new LedgerApp(repositories.entries);
  }

  total(): number {
    return this.entries.count();
  }
}

const ledger = defineProcessModule("annotation")
  .withRepositories(defineRepositories({ live: LiveRepositories, memory: MemoryRepositories }))
  .withApi(LedgerApp)
  .build();

describe("given an installed module that keeps relational state", () => {
  describe("when the deployment's configuration carries its connection string", () => {
    /** @scenario "A configured deployment names no store" */
    it("opens the store the module needs from that configuration, the composition naming none", async () => {
      built.length = 0;
      const server = await Server.create("store-supply-test")
        .withEnvironment({ DATABASE_URL: "postgresql://ledger:unused@127.0.0.1:9/ledger" })
        .withConfig(processConfig([ledger], "worker"))
        .withHealthPort(0)
        .withProcessOwnership(false)
        .withSecrets((_, secrets) => secrets.withEnv())
        .start();
      try {
        await server.container("worker").boot();

        expect(built).toEqual(["live"]);
      } finally {
        await server.close();
      }
    });
  });

  describe("when the deployment configured no database", () => {
    /** @scenario "A store a module needs and the deployment did not configure" */
    it("refuses the boot, naming the setting that would configure one", async () => {
      built.length = 0;
      const server = await Server.create("store-supply-test")
        .withEnvironment({})
        .withConfig(processConfig([ledger], "worker"))
        .withHealthPort(0)
        .withProcessOwnership(false)
        .withSecrets((_, secrets) => secrets.withEnv())
        .start();
      try {
        const boot = server.container("worker").boot();

        await expect(boot).rejects.toMatchObject({
          name: "MissingMemberError",
          module: "annotation",
          message: expect.stringContaining("set DATABASE_URL"),
        });
        expect(built).toEqual([]);
      } finally {
        await server.close();
      }
    });
  });

  describe("when the process chooses memory for its relational store", () => {
    /** @scenario "A test runs a module over memory" */
    it("boots without opening a database", async () => {
      built.length = 0;
      const runtime = await bootInstalledProcess({
        role: "worker",
        modules: [ledger],
        config: {},
        members: { ...memoryStores(), close: async () => void 0 },
      });

      try {
        expect(runtime.service(LedgerApi).total()).toBe(0);
        expect(built).toEqual(["memory"]);
      } finally {
        await runtime.stop();
      }
    });
  });
});
