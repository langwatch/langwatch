import { describe, expect, it, vi } from "vitest";

import { MemoryConnectedAgentRelayChannel } from "../../channels/memory/memory.connected-agent-relay.channel.ts";
import { MemoryConnectedAgentStateRepository } from "../../repositories/memory/memory.connected-agent-state.repository.ts";
import { ConnectedAgentReplyService } from "../connected-agent-reply.service.ts";

/** A relay whose listeners report when they are released. */
function watchedRelay() {
  const relay = MemoryConnectedAgentRelayChannel.create();
  const released = { replies: 0, gone: 0 };
  const listenForReplies = relay.listenForReplies.bind(relay);
  const listenForInstanceGone = relay.listenForInstanceGone.bind(relay);
  const replies = vi.spyOn(relay, "listenForReplies").mockImplementation(async (input) => {
    const unsubscribe = await listenForReplies(input);
    return async () => {
      released.replies += 1;
      await unsubscribe();
    };
  });
  const gone = vi.spyOn(relay, "listenForInstanceGone").mockImplementation(async (onGone) => {
    const unsubscribe = await listenForInstanceGone(onGone);
    return async () => {
      released.gone += 1;
      await unsubscribe();
    };
  });
  return { relay, released, spies: { replies, gone } };
}

function repliesOver(relay: MemoryConnectedAgentRelayChannel) {
  return ConnectedAgentReplyService.create({
    podId: "pod",
    state: MemoryConnectedAgentStateRepository.create(),
    relay,
    pollMs: 10,
  });
}

describe("ConnectedAgentReplyService lifecycle", () => {
  it("shares concurrent startup and releases both subscriptions on close", async () => {
    const { relay, released, spies } = watchedRelay();
    const replies = repliesOver(relay);

    await Promise.all([replies.start(), replies.start(), replies.start()]);
    expect(spies.replies).toHaveBeenCalledTimes(1);
    expect(spies.gone).toHaveBeenCalledTimes(1);

    await replies.close();
    expect(released).toEqual({ replies: 1, gone: 1 });
    await relay.close();
  });

  it("rolls back the first subscription when the second fails and can start again", async () => {
    const { relay, released, spies } = watchedRelay();
    const failure = new Error("subscription failed");
    spies.gone.mockRejectedValueOnce(failure);
    const replies = repliesOver(relay);

    await expect(replies.start()).rejects.toBe(failure);
    expect(released).toEqual({ replies: 1, gone: 0 });

    await replies.start();
    expect(spies.replies).toHaveBeenCalledTimes(2);
    expect(spies.gone).toHaveBeenCalledTimes(2);
    await replies.close();
    expect(released).toEqual({ replies: 2, gone: 1 });
    await relay.close();
  });

  it("settles an already cancelled call without waiting for its deadline", async () => {
    const relay = MemoryConnectedAgentRelayChannel.create();
    const replies = repliesOver(relay);
    const controller = new AbortController();
    controller.abort();

    await expect(
      replies.wait({
        projectId: "project",
        callId: "call",
        deadlineAt: Date.now() + 60_000,
        now: Date.now,
        signal: controller.signal,
      }),
    ).resolves.toEqual({ kind: "aborted" });
    await relay.close();
  });
});
