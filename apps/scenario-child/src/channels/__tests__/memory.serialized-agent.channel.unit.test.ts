import { describe, expect, it } from "vitest";

import { MemorySerializedAgentChannel } from "../memory/memory.serialized-agent.channel.ts";

const input = { threadId: "thread_1", messages: [], newMessages: [] };

describe("the scripted agent under test", () => {
  it("answers each turn from its script and keeps the session it returned", async () => {
    const agent = MemorySerializedAgentChannel.create();
    agent.answerWith({ reply: "hello", session: { turn: 1 } });

    await expect(agent.call(input)).resolves.toBe("hello");
    expect(agent.turns).toHaveLength(1);
    expect(agent.heldSession("thread_1")).toEqual({ turn: 1 });
  });

  it("refuses a turn it has no script for", async () => {
    await expect(MemorySerializedAgentChannel.create().call(input)).rejects.toThrow(
      "no scripted agent reply",
    );
  });
});
