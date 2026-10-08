import { Config } from "@langwatch/config";
import { moduleApi } from "@langwatch/module";
import { memoryStores } from "@langwatch/process-stores";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { FeatureApiUnavailableError, MissingProviderError } from "../src/boot-errors.ts";
import { bootInstalledProcess } from "../src/boot-installed-process.ts";
import {
  type BoundApis,
  defineChannels,
  defineProcessModule,
  defineRepositories,
  type FeatureSetup,
} from "../src/index.ts";
import { liveMemberSourceOf } from "./member-source.ts";

interface Bus {
  publish(message: string): string;
}
interface AlertChannels {
  readonly bus: Bus;
}

/** Every channel tier built, so a test can say which one ran and how often. */
const built: string[] = [];

class LiveAlertChannels {
  static readonly requires = ["redis"] as const;

  static create({
    redis,
    config,
  }: {
    redis: { prefix: string };
    config: { topic: string };
  }): AlertChannels {
    built.push("live");
    return { bus: { publish: (message) => `${redis.prefix}:${config.topic}:${message}` } };
  }
}

class MemoryAlertChannels {
  static readonly requires = [] as const;

  static create(): AlertChannels {
    built.push("memory");
    return { bus: { publish: (message) => `memory:${message}` } };
  }
}

const alertChannels = defineChannels({ live: LiveAlertChannels, memory: MemoryAlertChannels });

class AlertApp {
  static readonly contract = AlertApp;
  static readonly dependencies = {};
  static readonly config = Config.define((c) => ({ topic: c.env("ALERT_TOPIC", z.string()) }));

  static create({
    channels,
  }: FeatureSetup<Record<never, never>, never, { topic: string }, never, AlertChannels>): AlertApp {
    return new AlertApp(channels.bus);
  }

  constructor(readonly bus: Bus) {}
}

const alerts = defineProcessModule("automation")
  .withChannels(alertChannels)
  .withApi(AlertApp)
  .build();

class StoredApp {
  static readonly contract = StoredApp;
  static readonly dependencies = {};
  static readonly config = AlertApp.config;

  static create({
    repositories,
    channels,
  }: FeatureSetup<
    Record<never, never>,
    never,
    { topic: string },
    { read(): string },
    AlertChannels
  >): StoredApp {
    return new StoredApp(channels.bus.publish(repositories.read()));
  }

  constructor(readonly sent: string) {}
}

class LiveStoredRepositories {
  static readonly requires = [] as const;
  static create() {
    return { read: () => "live row" };
  }
}

class MemoryStoredRepositories {
  static readonly requires = [] as const;
  static create() {
    return { read: () => "memory row" };
  }
}

const stored = defineProcessModule("automation")
  .withRepositories(
    defineRepositories({ live: LiveStoredRepositories, memory: MemoryStoredRepositories }),
  )
  .withChannels(alertChannels)
  .withApi(StoredApp)
  .build();

describe("given a module that declares its channels with .withChannels", () => {
  describe("when a harness boots it over memory stores", () => {
    /** @scenario "The container builds a module's channels on the tier its stores state" */
    it("hands the module class its memory channels and never builds the live tier", async () => {
      built.length = 0;
      const runtime = await bootInstalledProcess({
        role: "api",
        modules: [alerts],
        config: { automation: { topic: "ops" } },
        stores: memoryStores(),
      });

      try {
        expect(runtime.module(alerts).provided.bus.publish("hi")).toBe("memory:hi");
        expect(built).toEqual(["memory"]);
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when a process states the live tier", () => {
    /** @scenario "The container builds a module's channels on the tier its stores state" */
    it("builds the live tier once, over the store it requires and the module's parsed config", async () => {
      built.length = 0;
      const runtime = await bootInstalledProcess({
        role: "api",
        modules: [alerts],
        config: { automation: { topic: "ops" } },
        stores: liveMemberSourceOf({ redis: { prefix: "redis" } }),
      });

      try {
        expect(runtime.module(alerts).provided.bus.publish("hi")).toBe("redis:ops:hi");
        expect(built).toEqual(["live"]);
      } finally {
        await runtime.stop();
      }
    });

    /** @scenario "A channel tier that needs a store the process did not open refuses boot by name" */
    it("refuses boot naming the module and the store, and builds no channel", async () => {
      built.length = 0;
      const boot = bootInstalledProcess({
        role: "api",
        modules: [alerts],
        config: { automation: { topic: "ops" } },
        stores: liveMemberSourceOf({}),
      });

      await expect(boot).rejects.toMatchObject({
        name: "MissingMemberError",
        module: "automation",
        member: "redis",
      });
      expect(built).toEqual([]);
    });
  });

  describe("when the module declares repositories as well", () => {
    /** @scenario "The container builds a module's channels on the tier its stores state" */
    it("builds channels on the same tier as the repositories", async () => {
      built.length = 0;
      const runtime = await bootInstalledProcess({
        role: "api",
        modules: [stored],
        config: { automation: { topic: "ops" } },
        stores: memoryStores(),
      });

      try {
        expect(runtime.module(stored).provided.sent).toBe("memory:memory row");
        expect(built).toEqual(["memory"]);
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when a channel tier reaches for a store it did not require", () => {
    /** @scenario "A channel tier that reaches for an undeclared store does not compile" */
    it("is a compile error, not an undefined at runtime", () => {
      class Undeclared {
        static readonly requires = [] as const;
        static create({ redis }: { redis: string }) {
          return { bus: redis };
        }
      }
      // @ts-expect-error the live tier reads `redis` without requiring it
      const registry = defineChannels({ live: Undeclared, memory: MemoryAlertChannels });
      expect(registry.kind).toBe("channels");
    });
  });
});

interface JudgeApi {
  judge(text: string): string;
}
const JudgeApi = moduleApi<JudgeApi>()("instant-eval");

interface ScoreApi {
  score(text: string): string;
}
const ScoreApi = moduleApi<ScoreApi>()("analytics");

interface ScoreChannels {
  readonly judge: Pick<JudgeApi, "judge">;
}

/** Both tiers bind the judge: the binding is to a module, not to a store. */
class BoundScoreChannels {
  static readonly requires = [] as const;
  static readonly binds = { judge: JudgeApi } as const;

  static create({ bound }: { bound: BoundApis<typeof BoundScoreChannels.binds> }): ScoreChannels {
    return { judge: { judge: (text) => bound.judge.judge(text) } };
  }
}

const scoreChannels = defineChannels({ live: BoundScoreChannels, memory: BoundScoreChannels });

/** Reached for its judge during construction, when asked to. */
let judgeWhileConstructing = false;

class ScoreApp implements ScoreApi {
  static readonly contract = ScoreApi;
  static readonly dependencies = {};

  static create({
    channels,
  }: FeatureSetup<Record<never, never>, never, undefined, never, ScoreChannels>): ScoreApp {
    if (judgeWhileConstructing) channels.judge.judge("too early");
    return new ScoreApp(channels.judge);
  }

  private constructor(private readonly judges: ScoreChannels["judge"]) {}

  score(text: string): string {
    return `scored ${this.judges.judge(text)}`;
  }
}

/** The judge's owner depends on the scorer: the shape a peer edge back would make a cycle. */
class JudgeApp implements JudgeApi {
  static readonly contract = JudgeApi;
  static readonly dependencies = { scores: ScoreApi };

  static create(): JudgeApp {
    return new JudgeApp();
  }

  judge(text: string): string {
    return `judged ${text}`;
  }
}

const scores = defineProcessModule("analytics")
  .withChannels(scoreChannels)
  .withApi(ScoreApp)
  .build();
const judges = defineProcessModule("instant-eval").withApi(JudgeApp).build();

describe("given a channel bound to another module's *Api token", () => {
  describe("when both modules are installed and the process has booted", () => {
    /** @scenario "A channel bound to another module's *Api is filled once both modules resolve" */
    it("calls the bound module without a peer edge, so its owner may depend back", async () => {
      judgeWhileConstructing = false;
      const runtime = await bootInstalledProcess({
        role: "api",
        modules: [scores, judges],
        config: {},
        stores: memoryStores(),
      });

      try {
        expect(runtime.service(ScoreApi).score("a reply")).toBe("scored judged a reply");
      } finally {
        await runtime.stop();
      }
    });

    /** @scenario "A channel bound to another module's *Api is filled once both modules resolve" */
    it("refuses a call made while the process is still constructing, by name", async () => {
      judgeWhileConstructing = true;
      const boot = bootInstalledProcess({
        role: "api",
        modules: [scores, judges],
        config: {},
        stores: memoryStores(),
      });

      await expect(boot).rejects.toBeInstanceOf(FeatureApiUnavailableError);
      await expect(boot).rejects.toMatchObject({ feature: "instant-eval" });
      judgeWhileConstructing = false;
    });
  });

  describe("when no installed module provides the bound token", () => {
    /** @scenario "A channel bound to an *Api nobody installed refuses boot by name" */
    it("refuses boot naming the module, the binding and the token", async () => {
      const boot = bootInstalledProcess({
        role: "api",
        modules: [scores],
        config: {},
        stores: memoryStores(),
      });

      await expect(boot).rejects.toBeInstanceOf(MissingProviderError);
      await expect(boot).rejects.toMatchObject({
        feature: "analytics",
        dependencyKey: "channels.judge",
      });
    });
  });

  describe("when a tier reads `bound` without declaring what it binds", () => {
    /** @scenario "A channel tier that reaches for an undeclared store does not compile" */
    it("is a compile error", () => {
      class Unbound {
        static readonly requires = [] as const;
        static create({ bound }: { bound: object }) {
          return { bound };
        }
      }
      // @ts-expect-error the memory tier reads `bound` but declares no `binds`
      const registry = defineChannels({ live: BoundScoreChannels, memory: Unbound });
      expect(registry.kind).toBe("channels");
    });
  });
});
