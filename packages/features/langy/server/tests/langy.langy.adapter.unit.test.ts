import type {
  LangyConversationCommands,
  LangyEventingPorts,
  LangyTurnTechnicalPorts,
} from "@langwatch/langy-server";
import { PostgresLangyAdapter } from "@langwatch/langy-server";
import type { LangyDatabase } from "../src/repositories/prisma/langy-database.port";
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
      sessionKeys: { mint: vi.fn() },
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
      metrics: { count: vi.fn() },
    });
    const database: LangyDatabase = undefined!;
    const instance = PostgresLangyAdapter.create({ database });

    const first = instance.build(options);
    const second = instance.build(options);

    expect(second).toBe(first);
    expect(first).toBeDefined();
  });
});
