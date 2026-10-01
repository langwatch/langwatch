import { SecretsChain } from "@langwatch/secrets";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveTasksConfig } from "../config.ts";
import { systemMigrationsPass } from "../system-migrations-pass.ts";

const dependencies = vi.hoisted(() => ({
  closeOrder: new Array<string>(),
  register: vi.fn(),
  producer: vi.fn(),
  connectDispatcher: vi.fn(),
  userMigrations: vi.fn(),
  newbornSweep: vi.fn(),
  createRunner: vi.fn(),
  runPass: vi.fn<() => Promise<void>>(),
  redis: vi.fn(),
  database: { name: "database" },
  dataplane: { dataplaneFor: () => ({ kind: "shared" as const }) },
  sender: { send: vi.fn() },
}));

vi.mock("@langwatch/redis-client", () => ({
  RedisConnectionService: class {
    connect = dependencies.redis;
  },
  RedisShutdownService: {
    create: () => ({
      shutdown: async () => {
        dependencies.closeOrder.push("redis");
      },
    }),
  },
}));
vi.mock("@langwatch/eventing", () => ({
  EventSourcing: class {
    constructor(options: unknown) {
      dependencies.producer(options);
    }
    register = dependencies.register;
    async close() {
      dependencies.closeOrder.push("eventing");
    }
  },
  EventStoreProducerOnly: { create: () => ({ name: "producer-store" }) },
  createEventingGroupQueueFactory: (options: unknown) => options,
}));
vi.mock("@langwatch/group-queue", () => ({
  GroupQueueDependenciesAdapter: { create: () => ({ dependencies: () => ({}) }) },
}));
vi.mock("@langwatch/authz-process", () => ({
  AuthzCommandDispatcherService: {
    create: () => ({ connect: dependencies.connectDispatcher }),
    sendersFrom: (commands: unknown) => commands,
  },
  PostgresAuthzAdapter: {
    create: () => ({ build: () => ({ pipeline: "authz", migration: "authz-migration" }) }),
  },
}));
vi.mock("@langwatch/identity-process", () => ({
  IdentityProducerPipelines: { create: () => ({ identityPipeline: () => "identity" }) },
  IdentityUserMigrations: { create: dependencies.userMigrations },
  IdentityNewbornSweep: { create: dependencies.newbornSweep },
  IdentityOrganizationMigrations: { create: () => ({ build: () => [] }) },
}));
vi.mock("@langwatch/ops-process", () => ({
  OpsSystemMigrations: { create: dependencies.createRunner },
  SystemMigrationsPassTask: {
    create: ({ pass }: { pass: () => (input: { signal: AbortSignal }) => Promise<void> }) => ({
      run: (input: { signal: AbortSignal }) => pass()(input),
    }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.closeOrder.length = 0;
  dependencies.redis.mockReturnValue({ name: "redis" });
  dependencies.register.mockReturnValue({ commands: { attachIdentifier: dependencies.sender } });
  dependencies.userMigrations.mockReturnValue({
    build: () => ["identifier-backfill", "secret-heal"],
  });
  dependencies.newbornSweep.mockReturnValue({ build: () => ({ runPass: async () => "swept" }) });
  dependencies.runPass.mockReset().mockResolvedValue();
  dependencies.createRunner.mockReturnValue({ runPass: dependencies.runPass });
});

/** What the boot seam builds from resolved handles, as a test supplies it. */
function connections() {
  return {
    database: {
      client: dependencies.database as never,
      hold: (run: () => Promise<void>) => run(),
      close: async () => {
        dependencies.closeOrder.push("database");
      },
    },
    redis: dependencies.redis() as never,
    dataplane: dependencies.dataplane,
  };
}

describe("given the system migration task", () => {
  describe("when Redis is configured", () => {
    it("registers both producer pipelines and both tenant axes, then closes producers before stores", async () => {
      const signal = new AbortController().signal;
      await systemMigrationsPass({
        config: resolveTasksConfig({ IS_SAAS: "true", NODE_ENV: "test" }),
        connections: connections(),
        chain: SecretsChain.start({ environment: {} }),
        environment: {},
        signal,
      });

      expect(dependencies.producer).toHaveBeenCalledWith(
        expect.objectContaining({
          consumersEnabled: false,
          processManagerMode: "producer-only",
          executionTarget: "task",
        }),
      );
      expect(dependencies.register.mock.calls).toEqual([["authz"], ["identity"]]);
      const options = dependencies.createRunner.mock.calls[0]?.[0];
      expect(options.migrations()).toEqual(["authz-migration"]);
      expect(options.userMigrations()).toEqual(["identifier-backfill", "secret-heal"]);
      expect(options.isSaaS()).toBe(true);
      await expect(options.newbornSweep()).resolves.toBe("swept");
      expect(options.dataplane).toBe(dependencies.dataplane);
      const identity = dependencies.userMigrations.mock.calls[0]?.[0].eventing;
      expect(dependencies.newbornSweep).toHaveBeenCalledWith({
        database: dependencies.database,
        eventing: identity,
      });
      await expect(
        identity.resolvePipelineCommand({ pipeline: "identity", command: "attachIdentifier" }),
      ).resolves.toEqual({ kind: "registered", sender: dependencies.sender });
      expect(dependencies.runPass).toHaveBeenCalledWith({ signal });
      // The task closes only what it made; the boot seam closes the stores.
      expect(dependencies.closeOrder).toEqual(["eventing"]);
    });
  });

  describe("when the migration pass fails", () => {
    it("closes every resource and propagates the failure", async () => {
      const failure = new Error("pass failed");
      dependencies.runPass.mockRejectedValueOnce(failure);
      await expect(
        systemMigrationsPass({
          config: resolveTasksConfig({ NODE_ENV: "test" }),
          connections: connections(),
          chain: SecretsChain.start({ environment: {} }),
          environment: {},
          signal: new AbortController().signal,
        }),
      ).rejects.toBe(failure);
      // The task closes only what it made; the boot seam closes the stores.
      expect(dependencies.closeOrder).toEqual(["eventing"]);
    });
  });

  describe("when Redis is absent", () => {
    it("preserves the user migrations and leaves the organization registry empty", async () => {
      dependencies.redis.mockReturnValue(null);
      await systemMigrationsPass({
        config: resolveTasksConfig({ NODE_ENV: "test" }),
        connections: connections(),
        chain: SecretsChain.start({ environment: {} }),
        environment: {},
        signal: new AbortController().signal,
      });
      expect(dependencies.producer).not.toHaveBeenCalled();
      const options = dependencies.createRunner.mock.calls[0]?.[0];
      expect(options.migrations()).toEqual([]);
      expect(options.userMigrations()).toEqual(["identifier-backfill", "secret-heal"]);
      const identity = dependencies.userMigrations.mock.calls[0]?.[0].eventing;
      await expect(
        identity.resolvePipelineCommand({ pipeline: "identity", command: "attachIdentifier" }),
      ).resolves.toEqual({ kind: "unregistered" });
      expect(dependencies.closeOrder).toEqual([]);
    });
  });
});
