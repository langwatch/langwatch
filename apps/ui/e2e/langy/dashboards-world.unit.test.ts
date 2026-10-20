import { AgentRole, type AgentInput } from "@langwatch/scenario";
import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";

import { assertTracesPerDay, reportWorldStateEachTurn, type World } from "./dashboards-world";
import { type LangyAdapter, makeLangyAdapter } from "./langy-agent";

const world = {} as World;

/** The real adapter with its network call swapped for a canned reply. */
function fakeAdapter({ conversationId }: { conversationId: string | null }): LangyAdapter {
  const adapter = makeLangyAdapter();
  adapter.state.conversationId = conversationId;
  return Object.assign(adapter, { call: async () => "reply" });
}

function turns(users: number): AgentInput {
  const messages: ModelMessage[] = Array.from({ length: users }, () => ({
    role: "user",
    content: "hi",
  }));
  return {
    threadId: "thread_1",
    messages,
    newMessages: messages.slice(-1),
    requestedRole: AgentRole.AGENT,
    scenarioState: {} as never,
    scenarioConfig: {} as never,
  };
}

describe("reportWorldStateEachTurn", () => {
  it("reports after setup before the first call, then after each turn", async () => {
    const moments: string[] = [];
    const adapter = reportWorldStateEachTurn({
      adapter: fakeAdapter({ conversationId: null }),
      world,
      report: async ({ moment }) => void moments.push(moment),
    });

    const reply = await adapter.call(turns(1));

    expect(reply).toBe("reply");
    expect(moments).toEqual(["after setup", "after turn 1"]);
  });

  it("skips the setup report once a conversation exists and counts user messages as turns", async () => {
    const moments: string[] = [];
    const adapter = reportWorldStateEachTurn({
      adapter: fakeAdapter({ conversationId: "conv_1" }),
      world,
      report: async ({ moment }) => void moments.push(moment),
    });

    await adapter.call(turns(2));

    expect(moments).toEqual(["after turn 2"]);
  });
});

describe("assertTracesPerDay", () => {
  it.each([24, 48, 240])("accepts %i", (count) => {
    expect(() => assertTracesPerDay(count)).not.toThrow();
  });

  it.each([0, 12, 25, -24])("refuses %i", (count) => {
    expect(() => assertTracesPerDay(count)).toThrow(
      expect.objectContaining({ code: "traces_per_day_invalid" }),
    );
  });
});
