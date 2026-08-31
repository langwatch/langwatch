/**
 * What `dispatch` refuses to send, and what it never sends twice.
 *
 * A settlement notification is a customer-visible email, Slack message or
 * webhook, dispatched from a queue that can redeliver. Everything asserted here
 * is a reason a trace should NOT produce one — a trigger switched off since the
 * match, a fold that has since gone, a confirmation that no longer holds, and a
 * trace already claimed by an earlier send. Each is a silent skip in the middle
 * of a loop, which is exactly the kind of thing a rewrite drops.
 *
 * The one loud path is a missing project: that raises a DispatchError marked
 * non-retryable, so the queue stops rather than redelivering forever.
 */

import { describe, expect, it } from "vitest";
import { TriggerSettlementNotificationService } from "../trigger-settlement-notification.service";

const TRIGGER = { id: "trigger-1", name: "Errors", action: "SEND_SLACK_MESSAGE" };
const FOLD = { computedInput: "in", computedOutput: "out", occurredAt: 1 };

function harness(
  options: {
    triggers?: unknown[];
    project?: unknown;
    fold?: unknown;
    confirms?: boolean;
    claimed?: boolean;
  } = {},
) {
  const seen = { summaries: [] as string[], confirmed: [] as string[], delivered: 0 };
  const composition = {
    automation: {
      getActiveTraceTriggersForProject: async () => options.triggers ?? [TRIGGER],
      isSendClaimed: async () => options.claimed ?? false,
      filterSendClaimed: async () => [],
      claimSend: async () => undefined,
      updateLastRunAt: async () => undefined,
    },
    projects: {
      tryGetById: async () =>
        options.project === undefined ? { id: "p", slug: "s" } : options.project,
    },
    traces: {
      tryGetSummary: async ({ traceId }: { traceId: string }) => {
        seen.summaries.push(traceId);
        return options.fold === undefined ? FOLD : options.fold;
      },
    },
    confirmation: {
      confirms: async ({ traceId }: { traceId: string }) => {
        seen.confirmed.push(traceId);
        return options.confirms ?? true;
      },
    },
    delivery: {
      send: async () => {
        seen.delivered += 1;
        return { ok: true };
      },
    },
    observability: { recordDispatch: () => undefined, recordFailure: () => undefined },
    clock: { now: () => new Date(0) },
    emailCaps: {},
    slack: {},
    webhooks: {},
    baseHost: "https://app.test",
    emailHourlyCap: 10,
    tenantDailyCap: 10,
  };

  return {
    seen,
    service: TriggerSettlementNotificationService.create(composition as never),
  };
}

const INPUT = {
  projectId: "project-1",
  triggerId: "trigger-1",
  traceIds: ["trace-1"],
  messageKey: "key-1",
};

describe("TriggerSettlementNotificationService.dispatch", () => {
  describe("given the trigger is no longer active on the project", () => {
    describe("when the queued digest arrives", () => {
      it("drops it without reading a trace", async () => {
        const { service, seen } = harness({ triggers: [] });

        await expect(service.dispatch(INPUT)).resolves.toBeUndefined();
        expect(seen.summaries).toEqual([]);
        expect(seen.delivered).toBe(0);
      });
    });
  });

  describe("given the project has gone", () => {
    describe("when the queued digest arrives", () => {
      it("fails in a way the queue will not retry", async () => {
        const { service } = harness({ project: null });

        await expect(service.dispatch(INPUT)).rejects.toMatchObject({ retryable: false });
      });
    });
  });

  describe("given a trace that should not produce a notification", () => {
    describe("when its fold has gone since the match", () => {
      it("sends nothing", async () => {
        const { service, seen } = harness({ fold: null });

        await service.dispatch(INPUT);

        expect(seen.delivered).toBe(0);
      });
    });

    describe("when the confirmation no longer holds", () => {
      it("sends nothing", async () => {
        const { service, seen } = harness({ confirms: false });

        await service.dispatch(INPUT);

        expect(seen.delivered).toBe(0);
      });
    });

    describe("when an earlier send already claimed it", () => {
      it("sends nothing, so a redelivered digest does not notify twice", async () => {
        const { service, seen } = harness({ claimed: true });

        await service.dispatch(INPUT);

        expect(seen.delivered).toBe(0);
      });
    });
  });

  describe("given the same trace id twice in one digest", () => {
    describe("when the digest is confirmed", () => {
      it("reads and confirms it once", async () => {
        const { service, seen } = harness({ confirms: false });

        await service.dispatch({ ...INPUT, traceIds: ["trace-1", "trace-1", "trace-2"] });

        expect(seen.summaries).toEqual(["trace-1", "trace-2"]);
        expect(seen.confirmed).toEqual(["trace-1", "trace-2"]);
      });
    });
  });
});
