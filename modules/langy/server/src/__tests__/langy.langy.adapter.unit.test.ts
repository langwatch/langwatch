import { EventEmitter } from "node:events";
import type {
  LangyConversationCommands,
  LangyEventingPorts,
  LangyTurnTechnicalPorts,
} from "@langwatch/langy-server";
import {
  LangyApp,
  LangyBlockOtelMetricsAdapter,
  LangyService,
  PostgresLangyAdapter,
} from "@langwatch/langy-server";
import {
  createRecordingMeterProvider,
  type RecordingMeterProvider,
} from "@langwatch/observability/metrics/testing";
import type { LangyDatabase } from "../repositories/prisma/langy-database.mapper.ts";
import { describe, expect, it, vi } from "vitest";

const COMMAND_NAMES = [
  "createConversation",
  "forkConversation",
  "recordMessage",
  "importMessage",
  "acceptAgentTurn",
  "initiateToolCall",
  "succeedToolCall",
  "failToolCall",
  "updatePlan",
  "failAgentResponse",
  "recordAgentResponse",
  "archiveConversation",
  "updateConversationMetadata",
  "recordTurnHandoff",
  "consumeTurnHandoff",
  "generateConversationTitle",
] as const;

function commands(): LangyConversationCommands {
  return Object.fromEntries(
    COMMAND_NAMES.map((name) => [name, vi.fn().mockResolvedValue(undefined)]),
  ) as unknown as LangyConversationCommands;
}

function composition(turns: LangyTurnTechnicalPorts) {
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

    const first: LangyEventingPorts = instance.eventing();
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
      context: { tryRender: vi.fn(() => null) },
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
      it("hands back the one service the adapter built, not a second graph", () => {
        const instance = PostgresLangyAdapter.create({ database: undefined! });
        const service = instance.build(compositionOptions());

        const app = createApp();

        expect(app.langyService).toBe(app.langyService);
        expect(createApp().langyService).not.toBe(app.langyService);
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
    context: { tryRender: vi.fn(() => null) },
    uiActionSurface: { resolve: vi.fn(async () => true) },
    metrics: { count: vi.fn() },
  });
}

function createApp(): LangyApp {
  const infrastructure = {
    database: undefined!,
    ...compositionOptions(),
    redis: null,
    broadcast: testBroadcast(),
  };
  return LangyApp.create({
    dependencies: {},
    infrastructure,
    config: { agentUrl: undefined, internalSecret: undefined },
    resources: { own: () => void 0, ownService: () => void 0 },
  });
}

/** The live-edge collaborators the application takes; these suites never use them. */
function testBroadcast() {
  return {
    getTenantEmitter: () => new EventEmitter(),
    cleanupTenantEmitter: () => void 0,
  };
}
