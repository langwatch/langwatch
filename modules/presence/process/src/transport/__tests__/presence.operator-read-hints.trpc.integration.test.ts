/**
 * @vitest-environment node
 * An operator's own read hints as the mounted `presence.onOperatorReadHints` door relays them to an
 * Ops tab with no organisation in scope. Spec: modules/ops/specs/event-log-search.feature
 */
import {
  bindTrpcMiddlewareContext,
  createTrpcRuntime,
  TrpcRootDefinition,
} from "@langwatch/api/trpc";
import { READ_INVALIDATED_BROADCAST_EVENT_TYPE } from "@langwatch/presence-contract";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it, vi } from "vitest";

import {
  createPresenceTestApp,
  TestPresenceEmitters,
} from "../../app/__tests__/presence.fixture.ts";
import { presenceSessionPersonContext, presenceTrpcTransport } from "../presence.trpc.ts";

type DoorContext = { actor: { id: string } | null };

const OPERATOR = "user_operator";
const MEMBER = "user_member";

async function mountedDoor() {
  const emitters = new TestPresenceEmitters();
  const app = await createPresenceTestApp({ emitters });
  const base = trpcTestMembers<DoorContext>();
  const root = TrpcRootDefinition.forContext<DoorContext>().create();
  const router = createTrpcRuntime<DoorContext>({
    root,
    procedure: root.procedure,
    members: {
      ...base,
      identity: {
        caller: (ctx) =>
          ctx.actor ? { actor: { type: "user", id: ctx.actor.id } } : { actor: null },
      },
      authorization: {
        forRequest: (ctx) => ({
          ...base.authorization.forRequest(ctx),
          getPlatformDecision: async ({ userId, permission }) => ({
            permitted: userId === OPERATOR && permission === "ops:view",
          }),
        }),
      },
    },
  }).mount(presenceTrpcTransport, () => app, {
    middlewareContext: [bindTrpcMiddlewareContext(presenceSessionPersonContext, () => null)],
  });

  return { router, emitters };
}

describe("the mounted presence.onOperatorReadHints door", () => {
  describe("given an operator holding the operator view grant", () => {
    /** @scenario "The operator read-hint stream relays the operator's own hints only" */
    it("relays the hint on the operator's own scope once, drops a malformed frame and listens on nothing else", async () => {
      const { router, emitters } = await mountedDoor();
      const stream = await router.createCaller({ actor: { id: OPERATOR } }).onOperatorReadHints();
      const iterator = stream[Symbol.asyncIterator]();
      const first = iterator.next();
      await vi.waitFor(() => expect(emitters.getTenantEmitter).toHaveBeenCalled());

      emitters.emitter.emit(READ_INVALIDATED_BROADCAST_EVENT_TYPE, { event: "{", timestamp: 0 });
      emitters.emitter.emit(READ_INVALIDATED_BROADCAST_EVENT_TYPE, {
        event: JSON.stringify({ path: "ops.getAggregateSearch" }),
        timestamp: 1,
      });

      await expect(first).resolves.toEqual({
        done: false,
        value: { path: "ops.getAggregateSearch" },
      });
      await iterator.return?.();
      expect(emitters.getTenantEmitter.mock.calls).toEqual([[OPERATOR]]);
      expect(emitters.cleanupTenantEmitter).toHaveBeenCalledWith(OPERATOR);
    });
  });

  describe("given a signed-in user who is not a platform operator", () => {
    /** @scenario "A reader without the operator view grant is refused the operator read-hint stream" */
    it("refuses the stream at the door and listens on nothing", async () => {
      const { router, emitters } = await mountedDoor();

      await expect(
        router.createCaller({ actor: { id: MEMBER } }).onOperatorReadHints(),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(emitters.getTenantEmitter).not.toHaveBeenCalled();
    });
  });
});
