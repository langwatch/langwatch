import type {
  LangyConversationCommands,
  LangyEventingCapabilities,
  LangyTurnCompositionPorts,
} from "@langwatch/langy-server";
import { PostgresLangyAdapter } from "@langwatch/langy-server";
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

function composition(turns: (ports: LangyTurnCompositionPorts) => object) {
  return {
    commands: commands(),
    credentials: () => ({
      sessionKeys: { mint: vi.fn() },
      virtualKeys: { provision: vi.fn() },
      github: { enabled: false, mintTurnToken: vi.fn() },
      runtime: {
        workerCallbackUrl: "https://langwatch.test/callback",
        workerGatewayBaseUrl: "https://langwatch.test/gateway",
        mirrorProjectId: undefined,
      },
    }),
    turns,
    feedbackPrompt: {},
  };
}

describe("PostgresLangyAdapter", () => {
  it("shares the memoized generic stores with every eventing consumer", () => {
    const instance = PostgresLangyAdapter.create({ database: {} });

    const first: LangyEventingCapabilities = instance.eventing();
    const second = instance.eventing();

    expect(second).toBe(first);
    expect(second.langyConversationState).toBe(first.langyConversationState);
    expect(second.langyConversationTurnState).toBe(
      first.langyConversationTurnState,
    );
    expect(second.langyMessageStorage).toBe(first.langyMessageStorage);
    expect(second.langyTurnAdmission).toBe(first.langyTurnAdmission);
  });

  it("builds one service graph from the same private repositories", () => {
    let received: LangyTurnCompositionPorts | undefined;
    const options = composition((ports) => {
      received = ports;
      return {};
    });
    const instance = PostgresLangyAdapter.create({ database: {} });

    const first = instance.build(options);
    const second = instance.build(options);

    expect(second).toBe(first);
    expect(received).toBeDefined();
    expect(received?.messages).toBeDefined();
    expect(received?.admission).toBeDefined();
    expect(received?.trustedMessages).toBeDefined();
  });
});
