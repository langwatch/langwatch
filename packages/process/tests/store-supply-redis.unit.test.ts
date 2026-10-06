/**
 * Spec: specs/server/typed-process-supply.feature,
 * "stores are built from the deployment's own configuration".
 */
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";

import { processConfig } from "../src/config.ts";
import { defineProcessModule, type FeatureSetup } from "../src/feature-installer.ts";
import { Server } from "../src/preamble.ts";
import { defineRepositories } from "../src/repository-registry.ts";

interface QueueApi {
  depth(): number;
}
const QueueApi = moduleApi<QueueApi>()("annotation");

/** Every repository built, so a test can say none was. */
const built: string[] = [];

class LiveRepositories {
  static readonly requires = ["redis"] as const;

  static create({ redis }: { redis: unknown }) {
    built.push(redis ? "live" : "live without a client");
    return { entries: { count: () => 0 } };
  }
}

class MemoryRepositories {
  static readonly requires = [] as const;

  static create() {
    built.push("memory");
    return { entries: { count: () => 0 } };
  }
}

class QueueApp implements QueueApi {
  static readonly contract = QueueApi;
  static readonly dependencies = {};

  private constructor(private readonly entries: { count(): number }) {}

  static create({
    repositories,
  }: FeatureSetup<{}, unknown, undefined, { entries: { count(): number } }>): QueueApp {
    return new QueueApp(repositories.entries);
  }

  depth(): number {
    return this.entries.count();
  }
}

const queued = defineProcessModule("annotation")
  .withRepositories(defineRepositories({ live: LiveRepositories, memory: MemoryRepositories }))
  .withApi(QueueApp)
  .build();

describe("given an installed module that keeps its state in Redis", () => {
  describe("when the deployment configured no Redis", () => {
    /**
     * @scenario "A queue a module needs and the deployment did not configure"
     * @scenario "A process with no queue refuses to boot, naming the setting"
     */
    it("refuses the boot, naming the setting that would configure one", async () => {
      built.length = 0;
      const server = await Server.create("store-supply-redis-test")
        .withEnvironment({})
        .withConfig(processConfig([queued], "worker"))
        .withHealthPort(0)
        .withProcessOwnership(false)
        .withSecrets((_, secrets) => secrets.withEnv())
        .start();
      try {
        const boot = server.container("worker").boot();

        await expect(boot).rejects.toMatchObject({
          name: "MissingMemberError",
          module: "annotation",
          message: expect.stringContaining("REDIS_URL"),
        });
        expect(built).toEqual([]);
      } finally {
        await server.close();
      }
    });
  });
});
