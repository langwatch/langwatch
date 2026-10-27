/**
 * @vitest-environment node
 * The upgrade runner's read hints as the mounted `presence.onUpgradeReadHints` door relays them:
 * operators only, and only the platform upgrade scope. Spec: modules/ops/specs/upgrades.feature
 */
import {
  bindTrpcMiddlewareContext,
  createTrpcRuntime,
  TrpcRootDefinition,
} from "@langwatch/api/trpc";
import { READ_INVALIDATED_BROADCAST_EVENT_TYPE } from "@langwatch/presence-contract";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { UPGRADE_READ_HINT_SCOPE, upgradeReadHintMessage } from "@langwatch/upgrade/runner";
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

/** A frame as the fan-out hands it to a scope's listeners: the serialised event and its time. */
function runnerFrame(): unknown {
  const message = upgradeReadHintMessage({
    hint: {
      path: "upgrade.run",
      runId: "run_1",
      phase: "postgres-schema",
      release: "3.23.0",
      outcome: "succeeded",
    },
    timestamp: 1,
  });
  const { event, timestamp } = JSON.parse(message) as { event: string; timestamp: number };
  return { event, timestamp };
}

describe("the mounted presence.onUpgradeReadHints door", () => {
  describe("given an operator holding the operator view grant", () => {
    /** @scenario "The upgrade read-hint stream relays the runner's hints and nothing else" */
    it("relays the runner's hint once, drops a malformed frame and listens on no tenant", async () => {
      const { router, emitters } = await mountedDoor();
      const stream = await router.createCaller({ actor: { id: OPERATOR } }).onUpgradeReadHints();
      const iterator = stream[Symbol.asyncIterator]();
      const first = iterator.next();
      await vi.waitFor(() => expect(emitters.getTenantEmitter).toHaveBeenCalled());

      emitters.emitter.emit(READ_INVALIDATED_BROADCAST_EVENT_TYPE, {
        event: JSON.stringify({ path: "upgrade.run" }),
        timestamp: 0,
      });
      emitters.emitter.emit(READ_INVALIDATED_BROADCAST_EVENT_TYPE, runnerFrame());

      await expect(first).resolves.toEqual({ done: false, value: { path: "upgrade.run" } });
      await iterator.return?.();
      expect(emitters.getTenantEmitter.mock.calls).toEqual([[UPGRADE_READ_HINT_SCOPE]]);
      expect(emitters.cleanupTenantEmitter).toHaveBeenCalledWith(UPGRADE_READ_HINT_SCOPE);
    });
  });

  describe("given a signed-in user who is not a platform operator", () => {
    /** @scenario "A reader without the operator view grant is refused the upgrade read-hint stream" */
    it("refuses the stream at the door and listens on nothing", async () => {
      const { router, emitters } = await mountedDoor();

      await expect(
        router.createCaller({ actor: { id: MEMBER } }).onUpgradeReadHints(),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(emitters.getTenantEmitter).not.toHaveBeenCalled();
    });
  });
});
