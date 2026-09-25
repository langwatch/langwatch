import { createApiFixture } from "@langwatch/api-fixture";
import type {
  LangyApi,
  LangyKeyCaller,
  LangyStartConversationTurnInput,
  LangyTurnSettlementWait,
} from "@langwatch/langy-contract";
import { describe, expect, it, vi } from "vitest";

import { LangyCanaryService } from "../langy-canary.service.ts";

const KEY: LangyKeyCaller = { actor: { type: "user", id: "owner-1" }, projectId: "project-1" };
const SETTLED: LangyTurnSettlementWait = {
  kind: "settled",
  settlement: { succeeded: true, outcome: "completed", text: "Hello!", error: null },
};

/** Waits until the signal ends the wait, as the real settlement waiter does. */
const untilAborted = ({ signal }: { signal: AbortSignal }): Promise<LangyTurnSettlementWait> =>
  new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve({ kind: "stopped" }), { once: true });
  });

function canary(options: {
  dark?: boolean;
  start?: LangyApi["startConversationTurn"];
  settle?: LangyApi["awaitTurnSettlement"];
  budgetMs?: number;
  now?: () => number;
}) {
  let turns = 0;
  const startConversationTurn = vi.fn(
    options.start ??
      (async (_input: LangyStartConversationTurnInput) => ({
        conversationId: "conv-1",
        turnId: `turn-${++turns}`,
      })),
  );
  const langy = createApiFixture<LangyApi>({
    getRestCaller: async (input) =>
      options.dark
        ? { dark: true }
        : { dark: false, projectId: input.projectId, userId: `user-of-${input.projectId}` },
    getRestActor: async ({ userId }) => ({ user: { id: userId } }),
    startConversationTurn,
    awaitTurnSettlement: options.settle ?? (async () => SETTLED),
  });
  const service = LangyCanaryService.create({
    langy,
    clock: { now: options.now ?? (() => Date.now()), budgetMs: options.budgetMs ?? 1_000 },
  });
  return { service, startConversationTurn };
}

describe("LangyCanaryService", () => {
  /** @scenario "The Langy canary sends the greeting as the key's owner with a fresh idempotency key" */
  /** @scenario "Every run starts its turn with a fresh idempotency key" */
  /** @scenario "The production turn is the greeting, sent as the key's owner" */
  /** @scenario "A healthy run reports the ids of the turn it sent" */
  /** @scenario "Every health response is uncacheable" */
  it("starts one greeting turn per check as the key's owner, under fresh keys", async () => {
    const { service, startConversationTurn } = canary({});

    const first = await service.probe(KEY);
    await service.probe(KEY);

    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(await first.json()).toMatchObject({
      status: "ok",
      conversationId: "conv-1",
      turnId: "turn-1",
    });
    const [a, b] = startConversationTurn.mock.calls.map(([input]) => input);
    expect(a?.session.user.id).toBe("user-of-project-1");
    expect(a?.messages).toEqual([{ role: "user", parts: [{ type: "text", text: "Hi Langy." }] }]);
    expect(a?.idempotencyKey).not.toBe(b?.idempotencyKey);
  });

  /** @scenario "The Langy canary answers a dark surface with a plain 404 and starts no turn" */
  /** @scenario "A switched-off surface answers the health check as a route that does not exist" */
  it("answers the plain 404 without Cache-Control and starts nothing", async () => {
    const { service, startConversationTurn } = canary({ dark: true });

    const answer = await service.probe(KEY);

    expect(answer.status).toBe(404);
    expect(await answer.text()).toBe("404 Not Found");
    expect(answer.headers.get("cache-control")).toBeNull();
    expect(startConversationTurn).not.toHaveBeenCalled();
  });

  /** @scenario "A Langy turn that does not settle inside the budget is timeout" */
  /** @scenario "A turn that does not settle inside the budget is timeout" */
  /** @scenario "Every health response is uncacheable" */
  it("reports timeout with the turn's ids when the wait outlasts the budget", async () => {
    const { service } = canary({ settle: untilAborted, budgetMs: 20 });

    const answer = await service.probe(KEY);

    expect(answer.status).toBe(503);
    expect(await answer.json()).toMatchObject({
      status: "unhealthy",
      reason: "timeout",
      conversationId: "conv-1",
      turnId: "turn-1",
    });
    expect(answer.headers.get("cache-control")).toBe("no-store");
  });

  /** @scenario "A Langy turn that cannot start is turn_failed" */
  /** @scenario "A turn that cannot even start is turn_failed" */
  it("reports turn_failed when the start throws", async () => {
    const { service } = canary({
      start: async () => {
        throw new Error("engine down");
      },
    });

    const body = await (await service.probe(KEY)).json();
    expect(body).toMatchObject({ reason: "turn_failed" });
    expect(body).not.toHaveProperty("conversationId");
  });

  /** @scenario "A second Langy check for the same caller while one is in flight is busy" */
  /** @scenario "A second check for the same caller while one is in flight is busy" */
  /** @scenario "Checks for different callers do not block each other" */
  /** @scenario "Every health response is uncacheable" */
  it("answers busy to the same caller in flight and runs another caller", async () => {
    const releases: ((wait: LangyTurnSettlementWait) => void)[] = [];
    const { service, startConversationTurn } = canary({
      settle: () => new Promise((resolve) => releases.push(resolve)),
    });

    const first = service.probe(KEY);
    await vi.waitFor(() => expect(startConversationTurn).toHaveBeenCalledTimes(1));
    const busy = await service.probe(KEY);
    const other = service.probe({ ...KEY, projectId: "project-2" });
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    for (const release of releases) release(SETTLED);

    expect(busy.status).toBe(429);
    expect(busy.headers.get("cache-control")).toBe("no-store");
    expect(await busy.json()).toEqual({ status: "busy" });
    expect((await first).status).toBe(200);
    expect((await other).status).toBe(200);
  });

  /** @scenario "A Langy timeout reserves the caller's slot for one further budget" */
  /** @scenario "A check arriving straight after a timeout is busy" */
  /** @scenario "The reservation a timeout takes lapses after one budget" */
  it("holds the caller's slot one budget after a timeout, then runs again", async () => {
    let clock = 0;
    const { service, startConversationTurn } = canary({
      settle: untilAborted,
      budgetMs: 20,
      now: () => clock,
    });

    expect((await service.probe(KEY)).status).toBe(503);
    expect((await service.probe(KEY)).status).toBe(429);
    clock = 21;
    expect((await service.probe(KEY)).status).toBe(503);
    expect(startConversationTurn).toHaveBeenCalledTimes(2);
  });

  /** @scenario "A settlement wait that ignores its signal is still timeout" */
  it("reports timeout inside the budget when the settlement wait never resolves", async () => {
    const { service } = canary({ settle: () => new Promise(() => undefined), budgetMs: 20 });

    expect(await (await service.probe(KEY)).json()).toMatchObject({ reason: "timeout" });
  });

  /** @scenario "A turn start that hangs is bounded by the same budget" */
  it("reports timeout when starting the turn never returns", async () => {
    const { service } = canary({ start: () => new Promise(() => undefined), budgetMs: 20 });

    expect(await (await service.probe(KEY)).json()).toMatchObject({ reason: "timeout" });
  });

  /** @scenario "The guard releases once the run settles" */
  it("runs the same caller's next check once the first has settled", async () => {
    const { service, startConversationTurn } = canary({});

    expect((await service.probe(KEY)).status).toBe(200);
    expect((await service.probe(KEY)).status).toBe(200);
    expect(startConversationTurn).toHaveBeenCalledTimes(2);
  });

  /** @scenario "A timeout for one caller does not reserve another caller" */
  it("runs another caller's check inside the budget a timeout reserved", async () => {
    const { service, startConversationTurn } = canary({
      settle: untilAborted,
      budgetMs: 20,
      now: () => 0,
    });

    expect((await service.probe(KEY)).status).toBe(503);
    expect((await service.probe({ ...KEY, projectId: "project-2" })).status).toBe(503);
    expect(startConversationTurn).toHaveBeenCalledTimes(2);
  });

  /** @scenario "A settled unhealthy run that is not a timeout reserves nothing" */
  it("runs the same caller's next check straight after a turn_failed", async () => {
    const { service, startConversationTurn } = canary({
      start: async () => {
        throw new Error("engine down");
      },
      now: () => 0,
    });

    expect(await (await service.probe(KEY)).json()).toMatchObject({ reason: "turn_failed" });
    expect(await (await service.probe(KEY)).json()).toMatchObject({ reason: "turn_failed" });
    expect(startConversationTurn).toHaveBeenCalledTimes(2);
  });
});
