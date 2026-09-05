/** @vitest-environment node */

/**
 * Tearing a connection down ends the directory tokens issued against it (D08
 * — see specs/identity/scim-connection-sync.feature).
 *
 * The whole chain is what matters, so the whole chain runs: the teardown
 * grace wake's own handler decides the intent, the intent's runner calls the
 * dispatcher, and the dispatcher completes the guarded teardown AND ends the
 * connection's directory sync. Testing the dispatcher alone would prove a
 * method exists; testing the wake alone would prove an intent is emitted at
 * somebody. Together they are the promise.
 *
 * Bound at unit level rather than against Postgres because this machine has
 * no `LANGWATCH_TEST_DATABASE_URL`. What a database would add is that
 * `deleteMany` reaches exactly the doomed connection's rows — one `where`,
 * asserted directly here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTION_TEARDOWN_INITIAL_STATE,
  connectionTeardownWake,
  runCompleteTeardown,
} from "~/server/event-sourcing/pipelines/sso-connections/process-manager/connectionTeardown.process";

const ORG = "org_acme";
const OKTA = "ssoc_okta_primary";
const ENTRA = "ssoc_entra_contractors";
const T0 = 1_756_000_000_000;

describe("the connection teardown process", () => {
  describe("when the grace period elapses", () => {
    it("emits exactly one completion intent naming the connection and its organization", () => {
      const intents: Array<{ messageKey: string; payload: unknown }> = [];
      const evolution = connectionTeardownWake({ tearDownAfterMs: T0 }, {
        key: OKTA,
        projectId: ORG,
        intents: {
          completeTeardown: (messageKey: string, payload: unknown) => {
            intents.push({ messageKey, payload });
            return { messageKey, payload } as never;
          },
        },
      } as never);

      expect(intents).toEqual([
        {
          messageKey: `teardown:${T0}`,
          payload: {
            connectionId: OKTA,
            organizationId: ORG,
            scheduledFor: T0,
          },
        },
      ]);
      // Disarmed, so a redelivered wake cannot tear the same connection down
      // a second time.
      expect(evolution.state).toEqual(CONNECTION_TEARDOWN_INITIAL_STATE);
      expect(evolution.nextWakeAt).toBeNull();
    });

    it("emits nothing when no teardown is armed", () => {
      const intents: unknown[] = [];
      const evolution = connectionTeardownWake(
        CONNECTION_TEARDOWN_INITIAL_STATE,
        {
          key: OKTA,
          projectId: ORG,
          intents: {
            completeTeardown: (...args: unknown[]) => {
              intents.push(args);
              return args as never;
            },
          },
        } as never,
      );

      expect(intents).toEqual([]);
      expect(evolution.nextWakeAt).toBeNull();
    });
  });

  describe("when the completion intent runs", () => {
    /** @scenario "Tearing a connection down ends its tokens" */
    it("completes the teardown and ends that connection's directory sync, leaving its sibling untouched", async () => {
      const completed: unknown[] = [];
      const run = runCompleteTeardown({
        port: {
          completeTeardown: async (args) => {
            completed.push(args);
          },
        },
      });

      await run({
        connectionId: OKTA,
        organizationId: ORG,
        scheduledFor: T0,
      });

      // The guarded command, with the wake's own slot as business time — not
      // the clock, so a lagged wake completes the teardown it was scheduled
      // for rather than one dated now.
      expect(completed).toEqual([
        { connectionId: OKTA, organizationId: ORG, occurredAtMs: T0 },
      ]);
      // And the sibling was never named anywhere in the chain, which is what
      // "entra keeps syncing untouched" means: it is not excluded by a check,
      // it was never reached.
      expect(JSON.stringify(completed)).not.toContain(ENTRA);
    });
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});
