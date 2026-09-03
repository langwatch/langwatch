/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import type { ProcessHandlerContext } from "@langwatch/eventing";
import {
  CONNECTION_TEARDOWN_INITIAL_STATE,
  type ConnectionTeardownIntents,
  type ConnectionTeardownPort,
  connectionTeardownWake,
  onTeardownRequested,
  onTornDown,
  runCompleteTeardown,
} from "../connection-teardown.process";

const ORG = "org_acme";
const CONNECTION = "ssoc_1";
const T0 = 1_756_000_000_000;
const GRACE_MS = 7 * 24 * 60 * 60 * 1000;

function context(at: number): ProcessHandlerContext<ConnectionTeardownIntents> {
  return {
    at,
    now: at,
    key: CONNECTION,
    projectId: ORG,
    intents: {
      completeTeardown: (key: string, payload: unknown) => ({
        messageKey: key,
        intentType: "completeTeardown",
        payload,
      }),
    },
  } as unknown as ProcessHandlerContext<ConnectionTeardownIntents>;
}

describe("the connection teardown grace", () => {
  describe("given a connection in TEARDOWN_PENDING", () => {
    /** @scenario "Teardown completes only after its grace period" */
    it("arms the wake at the deadline the request carried", () => {
      const evolution = onTeardownRequested(
        CONNECTION_TEARDOWN_INITIAL_STATE,
        { tearDownAfterMs: T0 + GRACE_MS },
        context(T0),
      );

      expect(evolution.state).toEqual({ tearDownAfterMs: T0 + GRACE_MS });
      // The fact's own deadline, not `now + grace`: a redelivered event must
      // not push the deadline out every time it arrives.
      expect(evolution.nextWakeAt).toBe(T0 + GRACE_MS);
    });

    /** @scenario "Teardown completes only after its grace period" */
    it("dispatches the completion command when the grace elapses", async () => {
      const armed = onTeardownRequested(
        CONNECTION_TEARDOWN_INITIAL_STATE,
        { tearDownAfterMs: T0 + GRACE_MS },
        context(T0),
      );

      const woken = connectionTeardownWake(armed.state, context(T0 + GRACE_MS));

      expect(woken.nextWakeAt).toBeNull();
      expect(woken.state).toEqual(CONNECTION_TEARDOWN_INITIAL_STATE);
      expect(woken.intents).toHaveLength(1);
      expect(woken.intents?.[0]).toMatchObject({
        intentType: "completeTeardown",
        payload: {
          connectionId: CONNECTION,
          organizationId: ORG,
          scheduledFor: T0 + GRACE_MS,
        },
      });

      const port: ConnectionTeardownPort = { completeTeardown: vi.fn() };
      await runCompleteTeardown({ port })(woken.intents![0]!.payload as never);
      expect(port.completeTeardown).toHaveBeenCalledWith({
        connectionId: CONNECTION,
        organizationId: ORG,
        // The slot the wake was scheduled for is the command's business time,
        // so a late-running worker completes the teardown as of the deadline
        // rather than as of whenever it got round to it.
        occurredAtMs: T0 + GRACE_MS,
      });
    });
  });

  describe("given a connection that already reached TORN_DOWN", () => {
    /** @scenario "Teardown completes only after its grace period" */
    it("disarms the wake so nothing fires afterwards", () => {
      const armed = onTeardownRequested(
        CONNECTION_TEARDOWN_INITIAL_STATE,
        { tearDownAfterMs: T0 + GRACE_MS },
        context(T0),
      );
      const disarmed = onTornDown(armed.state, {}, context(T0 + 10));

      expect(disarmed.nextWakeAt).toBeNull();
      expect(
        connectionTeardownWake(disarmed.state, context(T0 + GRACE_MS)).intents,
      ).toBeUndefined();
    });
  });
});
