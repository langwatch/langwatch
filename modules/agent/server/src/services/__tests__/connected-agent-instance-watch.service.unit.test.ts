import { AgentSessionUnknownError } from "@langwatch/agent-contract";
import { SessionStateStoreFactory } from "@langwatch/redis-client";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";
import { instanceChannel } from "../../rules/connected-agent-keys.rules.ts";
import { InstanceWatchService } from "../connected-agent-instance-watch.service.ts";
import { ConnectedAgentRuntimeService } from "../connected-agent-runtime.service.ts";
import type { AgentSessionService, SessionInfo } from "../connected-agent-session.service.ts";

const session: SessionInfo = {
  projectId: "project",
  principalId: "key:test",
  projectSlug: "project",
  instanceId: "instance",
  agentIds: new Set(["agent"]),
  meta: {
    projectId: "project",
    instanceId: "instance",
    podId: "pod",
    hostname: "host",
    username: "user",
    pid: 1,
    sdk: { name: "sdk", version: "1", language: "python" },
    label: null,
    connectedAt: 0,
    maxConcurrency: 1,
  },
};

function fixture() {
  const store = SessionStateStoreFactory.memory();
  const runtime = ConnectedAgentRuntimeService.create({ store });
  const watches = InstanceWatchService.create({
    core: createApiFixture<AgentSessionService>({ runtime }),
    watchTtlMs: 60_000,
  });
  const subscribe = store.subscribe.bind(store);
  let resolve: () => void = () => void 0;
  let reject: (error: unknown) => void = () => void 0;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  const gate = { promise, resolve, reject };
  const subscribed = vi.spyOn(store, "subscribe").mockImplementation(async (channel, handler) => {
    await gate.promise;
    return subscribe(channel, handler);
  });
  return { store, watches, gate, subscribed };
}

describe("InstanceWatchService subscription lifecycle", () => {
  it("makes concurrent polls wait for the same ready subscription", async () => {
    const { store, watches, gate, subscribed } = fixture();
    const first = watches.ensureWatch(session);
    const settled = vi.fn();
    const second = watches.ensureWatch(session).then((watch) => {
      settled();
      return watch;
    });
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    gate.resolve();
    expect(await second).toBe(await first);
    expect(subscribed).toHaveBeenCalledTimes(1);
    await watches.closeAll();
    expect(await store.publish(instanceChannel(session.projectId, session.instanceId), "{}")).toBe(
      0,
    );
    await store.close();
  });

  it("releases a pending subscription when shutdown starts before it answers", async () => {
    const { store, watches, gate } = fixture();
    const pending = watches.ensureWatch(session);
    const rejected = expect(pending).rejects.toBeInstanceOf(AgentSessionUnknownError);
    const closing = watches.closeAll();
    gate.resolve();

    await rejected;
    await closing;
    expect(watches.watchCount).toBe(0);
    expect(await store.publish(instanceChannel(session.projectId, session.instanceId), "{}")).toBe(
      0,
    );
    await store.close();
  });

  it("removes failed watches so the next poll can subscribe again", async () => {
    const { store, watches, gate } = fixture();
    const failure = new Error("subscribe failed");
    const failed = expect(watches.ensureWatch(session)).rejects.toBe(failure);
    gate.reject(failure);
    await failed;
    expect(watches.watchCount).toBe(0);

    vi.mocked(store.subscribe).mockRestore();
    await watches.ensureWatch(session);
    expect(await store.publish(instanceChannel(session.projectId, session.instanceId), "{}")).toBe(
      1,
    );
    await watches.closeAll();
    await store.close();
  });
});
