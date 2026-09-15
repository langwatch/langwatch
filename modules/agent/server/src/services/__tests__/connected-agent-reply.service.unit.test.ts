import { SessionStateStoreFactory } from "@langwatch/redis-client";
import { describe, expect, it, vi } from "vitest";
import { INSTANCE_GONE_CHANNEL, replyChannel } from "../../rules/connected-agent-keys.rules.ts";
import { ConnectedAgentReplyService } from "../connected-agent-reply.service.ts";

describe("ConnectedAgentReplyService lifecycle", () => {
  it("shares concurrent startup and releases both subscriptions on close", async () => {
    const store = SessionStateStoreFactory.memory();
    const subscribe = vi.spyOn(store, "subscribe");
    const replies = ConnectedAgentReplyService.create({ podId: "pod", store, pollMs: 10 });

    await Promise.all([replies.start(), replies.start(), replies.start()]);
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(await store.publish(replyChannel("pod"), "{}")).toBe(1);

    await replies.close();
    expect(await store.publish(replyChannel("pod"), "{}")).toBe(0);
    expect(await store.publish(INSTANCE_GONE_CHANNEL, "{}")).toBe(0);
    await store.close();
  });

  it("rolls back the first subscription when the second fails and can start again", async () => {
    const store = SessionStateStoreFactory.memory();
    const subscribe = store.subscribe.bind(store);
    const failure = new Error("subscription failed");
    vi.spyOn(store, "subscribe").mockImplementation(async (channel, handler) => {
      if (channel === INSTANCE_GONE_CHANNEL) throw failure;
      return subscribe(channel, handler);
    });
    const replies = ConnectedAgentReplyService.create({ podId: "pod", store, pollMs: 10 });

    await expect(replies.start()).rejects.toBe(failure);
    expect(await store.publish(replyChannel("pod"), "{}")).toBe(0);

    vi.mocked(store.subscribe).mockImplementation(subscribe);
    await replies.start();
    expect(await store.publish(INSTANCE_GONE_CHANNEL, "{}")).toBe(1);
    await replies.close();
    await store.close();
  });

  it("settles an already cancelled call without waiting for its deadline", async () => {
    const store = SessionStateStoreFactory.memory();
    const replies = ConnectedAgentReplyService.create({ podId: "pod", store, pollMs: 10 });
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
    await store.close();
  });
});
