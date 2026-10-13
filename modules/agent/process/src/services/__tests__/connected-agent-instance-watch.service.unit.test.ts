import { AgentSessionUnknownError } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { MemoryConnectedAgentRelayChannel } from "../../channels/memory/memory.connected-agent-relay.channel.ts";
import { MemoryConnectedAgentStateRepository } from "../../repositories/memory/memory.connected-agent-state.repository.ts";
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
  const relay = MemoryConnectedAgentRelayChannel.create();
  const runtime = ConnectedAgentRuntimeService.create({
    state: MemoryConnectedAgentStateRepository.create(),
    relay,
  });
  const watches = InstanceWatchService.create({
    core: createApiFixture<AgentSessionService>({ runtime }),
    watchTtlMs: 60_000,
  });
  const listenToInstance = relay.listenToInstance.bind(relay);
  let resolve: () => void = () => void 0;
  let reject: (error: unknown) => void = () => void 0;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  const gate = { promise, resolve, reject };
  const subscribed = vi.spyOn(relay, "listenToInstance").mockImplementation(async (input) => {
    await gate.promise;
    return listenToInstance(input);
  });
  return { relay, watches, gate, subscribed };
}

describe("InstanceWatchService subscription lifecycle", () => {
  it("makes concurrent polls wait for the same ready subscription", async () => {
    const { relay, watches, gate, subscribed } = fixture();
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
    expect(await probe(relay)).toBe(0);
    await relay.close();
  });

  it("releases a pending subscription when shutdown starts before it answers", async () => {
    const { relay, watches, gate } = fixture();
    const pending = watches.ensureWatch(session);
    pending.catch(() => undefined);
    const closing = watches.closeAll();
    gate.resolve();

    await expect(pending).rejects.toBeInstanceOf(AgentSessionUnknownError);
    await closing;
    expect(watches.watchCount).toBe(0);
    expect(await probe(relay)).toBe(0);
    await relay.close();
  });

  it("removes failed watches so the next poll can subscribe again", async () => {
    const { relay, watches, gate, subscribed } = fixture();
    const failure = new Error("subscribe failed");
    const watching = watches.ensureWatch(session);
    watching.catch(() => undefined);
    gate.reject(failure);
    await expect(watching).rejects.toBe(failure);
    expect(watches.watchCount).toBe(0);

    subscribed.mockRestore();
    await watches.ensureWatch(session);
    expect(await probe(relay)).toBe(1);
    await watches.closeAll();
    await relay.close();
  });
});

/** How many listeners an instance nudge reaches now. */
function probe(relay: MemoryConnectedAgentRelayChannel): Promise<number> {
  return relay.nudgeInstance({
    projectId: session.projectId,
    instanceId: session.instanceId,
    nudge: { call: "probe" },
  });
}
