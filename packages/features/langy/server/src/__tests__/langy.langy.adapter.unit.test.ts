import { EventEmitter } from "node:events";
import type {
  LangyConversationCommands,
  LangyEventingPorts,
  LangyTurnTechnicalPorts,
} from "@langwatch/langy-server";
import { LangyApp, PostgresLangyAdapter } from "@langwatch/langy-server";
import { LangyService } from "@langwatch/langy-contract";
import type { LangyDatabase } from "../repositories/prisma/langy-database.port";
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

  describe("given a process that built Langy once", () => {
    describe("when a transport asks the application for the capability", () => {
      /** @scenario "transports share one Langy capability" */
      it("hands back the one service the adapter built, not a second graph", () => {
        const instance = PostgresLangyAdapter.create({ database: undefined! });
        const service = instance.build(compositionOptions());

        const app = LangyApp.create({ langy: service, redis: null, broadcast: testBroadcast() });

        expect(app.langyService).toBe(service);
        expect(
          LangyApp.create({ langy: service, redis: null, broadcast: testBroadcast() }).langyService,
        ).toBe(app.langyService);
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

/** The live-edge collaborators the application takes; these suites never use them. */
function testBroadcast() {
  return {
    getTenantEmitter: () => new EventEmitter(),
    cleanupTenantEmitter: () => void 0,
  };
}
