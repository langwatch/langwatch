import { describe, expect, it, vi } from "vitest";

import {
  EventingLangyMaintenanceAdapter,
  LANGY_SESSION_KEYS_METRIC_NAME,
  LANGY_SESSION_KEY_REAP_PROCESS_NAME,
  langySessionKeyReapWake,
  runLangySessionKeyReap,
} from "@langwatch/langy-server";

const wakeContext = (at: number) => ({
  at,
  now: at,
  key: LANGY_SESSION_KEY_REAP_PROCESS_NAME,
  projectId: "__global__",
  intents: {
    reap: (key: string, payload: unknown) => ({ type: "reap", key, payload }),
  },
});

describe("langySessionKeyReap process", () => {
  describe("given the schedule fires", () => {
    describe("when the wake handler runs", () => {
      it("emits one reap intent keyed by the tick", () => {
        const evolution = langySessionKeyReapWake(
          { lastReapAt: null },
          wakeContext(1_000) as never,
        );

        expect(evolution.state).toEqual({ lastReapAt: 1_000 });
        expect(evolution.intents).toEqual([
          { type: "reap", key: "reap:1000", payload: { scheduledFor: 1_000 } },
        ]);
      });

      it("keys the intent by the tick so a redelivered wake collapses", () => {
        const first = langySessionKeyReapWake(
          { lastReapAt: null },
          wakeContext(2_000) as never,
        );
        const redelivered = langySessionKeyReapWake(
          { lastReapAt: 2_000 },
          wakeContext(2_000) as never,
        );

        expect(redelivered.intents?.[0]).toEqual(first.intents?.[0]);
        expect(redelivered.intents?.[0]).toBeDefined();
      });
    });
  });

  describe("given expired session keys exist", () => {
    describe("when the reap intent runs", () => {
      it("revokes them and prunes its own bookkeeping rows", async () => {
        const reap = vi.fn(async () => 3);
        const deleteDispatchedBefore = vi.fn(async () => 0);

        await runLangySessionKeyReap({
          reap,
          deleteDispatchedBefore,
          now: () => 10_000_000,
        })();

        expect(reap).toHaveBeenCalledOnce();
        expect(deleteDispatchedBefore).toHaveBeenCalledWith({
          processName: LANGY_SESSION_KEY_REAP_PROCESS_NAME,
          before: 10_000_000 - 7 * 24 * 60 * 60 * 1000,
        });
      });
    });
  });

  describe("given the outbox retention prune fails", () => {
    describe("when the reap intent runs", () => {
      it("still counts the reap as done rather than retrying the revoke", async () => {
        const reap = vi.fn(async () => 1);

        await expect(
          runLangySessionKeyReap({
            reap,
            deleteDispatchedBefore: vi.fn(async () => {
              throw new Error("pg down");
            }),
          })(),
        ).resolves.toBeUndefined();

        expect(reap).toHaveBeenCalledOnce();
      });
    });
  });

  describe("given the pipeline is built", () => {
    describe("when its shape is inspected", () => {
      it("registers the reap as a scheduled process and appends no events", () => {
        const pipeline = EventingLangyMaintenanceAdapter.create({
          sessionKeyReap: {
            reap: async () => 0,
            deleteDispatchedBefore: async () => 0,
          },
        }).buildProcessing();

        const pm = pipeline.processManagers.get(LANGY_SESSION_KEY_REAP_PROCESS_NAME);
        expect(pm).toBeDefined();
        expect(pm?.config.schedule?.everyMs).toBeGreaterThan(0);
        // No event handlers: a scheduled-only process must not register a
        // subscriber, or a credential sweep starts costing per-event work.
        expect(pm?.config.eventTypes).toHaveLength(0);
      });
    });
  });
});

/**
 * The names two graphs register, pinned to literals.
 *
 * The App's legacy registry still holds a frozen copy of this pipeline and the
 * packaged worker now builds its own. A drifted pipeline or process name is a
 * routing key on `event-sourcing/jobs` that only one of the two consumers ever
 * stages, and a drifted metric name splits one lifecycle counter across two
 * series. Both failures look like a sweep that is simply quiet, so these
 * literals may only change in a commit that changes the twin as well.
 */
describe("the Langy maintenance pipeline's frozen twin", () => {
  describe("given the legacy registry holds a copy of it", () => {
    describe("when either graph registers it", () => {
      /** @scenario "The session-key sweep keeps one set of routing keys across both graphs" */
      it("names the pipeline the twin names", () => {
        const pipeline = EventingLangyMaintenanceAdapter.create({
          sessionKeyReap: {
            reap: async () => 0,
            deleteDispatchedBefore: async () => 0,
          },
        }).buildProcessing();

        expect(pipeline.metadata.name).toBe("langy_maintenance");
      });

      /** @scenario "The session-key sweep keeps one set of routing keys across both graphs" */
      it("names the scheduled process the twin names", () => {
        expect(LANGY_SESSION_KEY_REAP_PROCESS_NAME).toBe("langySessionKeyReap");
      });
    });

    describe("when either of them reaps a key", () => {
      /** @scenario "Both graphs count reaped keys into one series" */
      it("counts into the series the App's registry declares", () => {
        expect(LANGY_SESSION_KEYS_METRIC_NAME).toBe("langwatch_langy_session_keys_total");
      });
    });
  });
});
