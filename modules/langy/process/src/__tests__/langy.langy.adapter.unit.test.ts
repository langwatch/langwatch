import { EventEmitter } from "node:events";

import { createApiFixture } from "@langwatch/api-fixture";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import {
  EventSourcing,
  EventStoreProducerOnly,
  type EventSourcedQueueDefinition,
  type EventSourcedQueueProcessor,
} from "@langwatch/eventing";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type {
  LangyConversationCommands,
  LangyEventingMembers,
  LangyTurnTechnicalMembers,
} from "@langwatch/langy-process";
import { LangyBlockOtelMetricsAdapter, PostgresLangyAdapter } from "@langwatch/langy-process";
import {
  createRecordingMeterProvider,
  type RecordingMeterProvider,
} from "@langwatch/observability/metrics/testing";
import type { PresenceApi } from "@langwatch/presence-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { ScopedSecrets } from "@langwatch/secrets";
import { describe, expect, it, vi } from "vitest";

import { LangyApp } from "../app/langy.app.ts";
import type { LangyRepositories } from "../repositories/langy-repositories.registry.ts";
import type { LangyDatabase } from "../repositories/prisma/langy-database.mapper.ts";
import { LangyService } from "../services/langy.service.ts";

function commands(): LangyConversationCommands {
  const sent = async () => undefined;
  return {
    createConversation: vi.fn(sent),
    forkConversation: vi.fn(sent),
    recordMessage: vi.fn(sent),
    importMessage: vi.fn(sent),
    acceptAgentTurn: vi.fn(sent),
    initiateToolCall: vi.fn(sent),
    succeedToolCall: vi.fn(sent),
    failToolCall: vi.fn(sent),
    updatePlan: vi.fn(sent),
    failAgentResponse: vi.fn(sent),
    recordAgentResponse: vi.fn(sent),
    archiveConversation: vi.fn(sent),
    updateConversationMetadata: vi.fn(sent),
    recordTurnHandoff: vi.fn(sent),
    consumeTurnHandoff: vi.fn(sent),
    generateConversationTitle: vi.fn(sent),
    requestLocalControl: vi.fn(sent),
    connectLocalWorkspace: vi.fn(sent),
    disconnectLocalWorkspace: vi.fn(sent),
    changeLocalPolicy: vi.fn(sent),
    startUserWait: vi.fn(sent),
    endUserWait: vi.fn(sent),
  };
}

function composition(turns: LangyTurnTechnicalMembers) {
  return {
    commands: commands(),
    credentials: {
      sessionKeys: { mint: vi.fn(), revokeManaged: vi.fn() },
      virtualKeys: { provision: vi.fn() },
      github: { enabled: false, mintTurnToken: vi.fn() },
      runtime: {
        workerCallbackUrl: "https://langwatch.test/callback",
        workerGatewayBaseUrl: "https://langwatch.test/gateway",
        mirrorProjectId: undefined,
      },
    },
    turns,
    feedbackPromptRedis: null,
  };
}

describe("PostgresLangyAdapter", () => {
  it("shares the memoized generic stores with every eventing consumer", () => {
    const database: LangyDatabase = undefined!;
    const instance = PostgresLangyAdapter.create({ database });

    const first: LangyEventingMembers = instance.eventing();
    const second = instance.eventing();

    expect(second).toBe(first);
    expect(second.langyConversationState).toBe(first.langyConversationState);
    expect(second.langyConversationTurnState).toBe(first.langyConversationTurnState);
    expect(second.langyMessageStorage).toBe(first.langyMessageStorage);
    expect(second.langyTurnAdmission).toBe(first.langyTurnAdmission);
  });

  it("builds one service graph from the same private repositories", () => {
    const options = composition({
      models: { resolve: vi.fn() },
      worker: null,
      tokenBuffer: null,
      accessStore: null,
      handoffStore: null,
      permits: {
        reserve: vi.fn(),
        release: vi.fn(),
        check: vi.fn(),
      },
      perDayPrCap: 0,
      sessionKeys: {
        mint: vi.fn(),
        revoke: vi.fn(),
      },
      context: { render: vi.fn(() => null) },
      uiActionSurface: { resolve: vi.fn(async () => true) },
      metrics: { count: vi.fn() },
    });
    const database: LangyDatabase = undefined!;
    const instance = PostgresLangyAdapter.create({ database });

    const first = instance.build(options);
    const second = instance.build(options);

    expect(second).toBe(first);
    expect(first).toBeDefined();
  });

  describe("given a deployment that composed a block-metrics collector", () => {
    describe("when a finalized turn's derived card fails to salvage", () => {
      /** @scenario "a finalized turn's block salvage is counted on the published series" */
      it("counts the failed block under the reason the salvage answered with", async () => {
        const metrics: RecordingMeterProvider = createRecordingMeterProvider();
        metrics.install();
        try {
          const instance = PostgresLangyAdapter.create({ database: undefined! });
          const service = instance.build({
            ...compositionOptions(),
            blockMetrics: LangyBlockOtelMetricsAdapter.create(),
          });

          await service.ingestAgentTurnResult({
            projectId: "project-1",
            conversationId: "conversation-1",
            turnId: "turn-1",
            status: "completed",
            text: ["before", "```langy-card", "this is not json", "```", "after"].join("\n"),
          });

          expect(metrics.valueOf("langwatch_langy_blocks_total")).toBe(1);
        } finally {
          metrics.uninstall();
        }
      });
    });
  });

  describe("given a process that built Langy once", () => {
    describe("when a transport asks the application for the capability", () => {
      /** @scenario "transports share one Langy capability" */
      it("hands back the one service the adapter built, not a second graph", async () => {
        const instance = PostgresLangyAdapter.create({ database: undefined! });
        const service = instance.build(compositionOptions());

        const app = await createApp();

        expect(app.langyService).toBe(app.langyService);
        expect((await createApp()).langyService).not.toBe(app.langyService);
        expect(instance.build(compositionOptions())).toBe(service);
      });
    });

    describe("when the composition root reads what it received", () => {
      /** @scenario "composition hides persistence" */
      it("receives the contract service, with no repository or database on its surface", () => {
        const instance = PostgresLangyAdapter.create({ database: undefined! });

        const service = instance.build(compositionOptions());

        expect(service).toBeInstanceOf(LangyService);
        expect(publicSurfaceOf(service).filter((name) => PERSISTENCE_WORDS.test(name))).toEqual([]);
      });

      /** @scenario "application transports use the flat contract" */
      it("publishes every capability as a flat method, naming no subordinate among them", () => {
        const instance = PostgresLangyAdapter.create({ database: undefined! });

        const service = instance.build(compositionOptions());
        const surface = publicSurfaceOf(service);

        for (const subordinate of ["conversations", "turns", "messages", "credentials"]) {
          expect(surface).not.toContain(subordinate);
        }
        expect(surface).toContain("getPage");
        expect(surface).toContain("startConversationTurn");
        expect(surface).toContain("ingestAgentTurnResult");
      });
    });
  });
});

const PERSISTENCE_WORDS = /repositor|prisma|database|store$/i;

/**
 * The methods the built service publishes. Instance fields are deliberately
 * skipped: the subordinate repositories are TypeScript-private fields, so what
 * a transport can legitimately call is the prototype surface.
 */
function publicSurfaceOf(service: object): string[] {
  const names = new Set<string>();

  for (
    let current: object | null = Object.getPrototypeOf(service) as object | null;
    current && current !== Object.prototype;
    current = Object.getPrototypeOf(current) as object | null
  ) {
    for (const name of Object.getOwnPropertyNames(current)) {
      if (name !== "constructor" && !name.startsWith("_") && !name.startsWith("#")) {
        names.add(name);
      }
    }
  }

  return [...names];
}

function compositionOptions() {
  return composition({
    models: { resolve: vi.fn() },
    worker: null,
    tokenBuffer: null,
    accessStore: null,
    handoffStore: null,
    permits: { reserve: vi.fn(), release: vi.fn(), check: vi.fn() },
    perDayPrCap: 0,
    sessionKeys: { mint: vi.fn(), revoke: vi.fn() },
    context: { render: vi.fn(() => null) },
    uiActionSurface: { resolve: vi.fn(async () => true) },
    metrics: { count: vi.fn() },
  });
}

/** No handle is ever resolved through it in these tests. */
const noSecrets = new ScopedSecrets(async (_handle, build) => build(undefined));

function createApp(): Promise<LangyApp> {
  return LangyApp.create({
    dependencies: {
      presence: testPresence(),
      featureFlags: createApiFixture<FeatureFlagApi>(),
      projects: createApiFixture<ProjectApi>({ getOrganizationId: async () => "org_1" }),
      plans: createApiFixture<EntitlementApi>(),
    },
    members: {
      prisma: undefined!,
      redis: createApiFixture<RedisConnection>(),
      eventing: producerEventing(),
      rateLimiter: { check: async () => ({ allowed: true }) },
    },
    config: { agentUrl: undefined },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: noSecrets,
    repositories: {} as LangyRepositories,
  });
}

/** The live-edge collaborators the application takes; these suites never use them. */
function testPresence(): PresenceApi {
  return {
    isEnabledForProject: () => Promise.resolve(true),
    update: () => Promise.resolve(),
    leave: () => Promise.resolve(),
    list: () => Promise.resolve([]),
    publishProjectEvent: () => Promise.resolve(),
    broadcastCursor: () => Promise.resolve(),
    events: async function* () {},
    cursors: async function* () {},
    getTenantEmitter: () => new EventEmitter(),
    cleanupTenantEmitter: () => void 0,
  };
}

/** Records what a producer enqueued; a producer-only process starts no consumer. */
function recordingQueue() {
  const factory = (
    _definition: EventSourcedQueueDefinition<Record<string, unknown>>,
  ): EventSourcedQueueProcessor<Record<string, unknown>> => ({
    async send() {},
    async sendBatch() {},
    async waitUntilReady() {},
    async close() {},
  });
  return { factory };
}

/**
 * A real, minimal producer-only `EventSourcing`: `EventSourcing` holds
 * private state, so only a real instance satisfies its type.
 */
function producerEventing(): EventSourcing {
  return new EventSourcing({
    enabled: true,
    eventStore: EventStoreProducerOnly.create({ processName: "langwatch-test" }),
    queueFactory: recordingQueue().factory,
    consumersEnabled: false,
    executionTarget: "api",
    processManagerMode: "producer-only",
  });
}
