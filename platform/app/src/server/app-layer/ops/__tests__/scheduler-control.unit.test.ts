import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduledJobRecord } from "../../scheduler/scheduler.types";
import {
  SchedulerOpsService,
  SLOT_STALE_AFTER_MS,
} from "../scheduler-ops.service";

const NOW = new Date("2026-08-11T12:00:00.000Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

const record = (over: Partial<ScheduledJobRecord> = {}): ScheduledJobRecord =>
  ({
    id: "sched_1",
    projectId: "project_acme",
    targetType: "scheduled_report",
    targetId: "report_1",
    cron: "0 3 21 * *",
    timezone: "UTC",
    nextRunAt: at(600_000),
    lastSlot: at(-600_000),
    currentSlot: null,
    attempts: 0,
    lastError: null,
    active: true,
    createdAt: at(-86_400_000),
    updatedAt: at(-1_000),
    ...over,
  }) as ScheduledJobRecord;

const makeService = (row: ScheduledJobRecord | null) => {
  const repo = {
    findByIdForOps: vi.fn().mockResolvedValue(row),
    setActiveForOps: vi.fn().mockResolvedValue(true),
    releaseSlotForOps: vi.fn().mockResolvedValue(true),
    requestImmediateRunForOps: vi.fn().mockResolvedValue(true),
    listForOps: vi.fn().mockResolvedValue([]),
  };
  const audit = { append: vi.fn().mockResolvedValue(undefined) };
  const wake = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new SchedulerOpsService(repo as any, audit, wake);
  return { service, repo, audit, wake };
};

const codeOf = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (error) {
    return (error as { code?: string }).code ?? "no-code";
  }
  return "did-not-throw";
};

describe("SchedulerOpsService controls", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("given a schedule that no longer exists", () => {
    describe("when a control is invoked", () => {
      it("refuses with a cause the operator can act on", async () => {
        const { service } = makeService(null);

        expect(
          await codeOf(() =>
            service.runNow({ scheduleId: "gone", actorUserId: "u1" }),
          ),
        ).toBe("schedule_not_found");
      });
    });
  });

  describe("given a paused schedule", () => {
    describe("when an operator runs it now", () => {
      it("refuses, naming the schedule as inactive", async () => {
        const { service, repo } = makeService(record({ active: false }));

        expect(
          await codeOf(() =>
            service.runNow({ scheduleId: "sched_1", actorUserId: "u1" }),
          ),
        ).toBe("schedule_inactive");
        expect(repo.requestImmediateRunForOps).not.toHaveBeenCalled();
      });
    });
  });

  describe("given an active schedule", () => {
    describe("when an operator runs it now", () => {
      it("makes it due rather than invoking the target directly", async () => {
        const { service, repo } = makeService(record());

        await service.runNow({
          scheduleId: "sched_1",
          actorUserId: "u1",
          now: NOW,
        });

        // The loop claims and executes; ops only moves the row's due instant.
        expect(repo.requestImmediateRunForOps).toHaveBeenCalledWith({
          id: "sched_1",
          expectedNextRunAt: at(600_000),
          now: NOW,
        });
      });

      it("guards the write on the fencing value it read", async () => {
        const { service, repo } = makeService(record());

        await service.runNow({
          scheduleId: "sched_1",
          actorUserId: "u1",
          now: NOW,
        });

        const call = repo.requestImmediateRunForOps.mock.calls[0]?.[0];
        expect(call.expectedNextRunAt).toEqual(at(600_000));
      });

      it("pokes the loop so it fires without waiting for the backstop", async () => {
        const { service, wake } = makeService(record());

        await service.runNow({
          scheduleId: "sched_1",
          actorUserId: "u1",
          now: NOW,
        });

        expect(wake).toHaveBeenCalled();
      });

      it("records the action against its actor and schedule", async () => {
        const { service, audit } = makeService(record());

        await service.runNow({
          scheduleId: "sched_1",
          actorUserId: "user_42",
          now: NOW,
        });

        expect(audit.append).toHaveBeenCalledWith(
          expect.objectContaining({
            actorUserId: "user_42",
            action: "ops.scheduler.run_now",
            scheduleId: "sched_1",
            projectId: "project_acme",
          }),
        );
      });
    });
  });

  describe("given the loop claims the slot first", () => {
    describe("when the operator's run lands after it", () => {
      it("changes nothing and says the scheduler got there first", async () => {
        const { service, repo } = makeService(record());
        repo.requestImmediateRunForOps.mockResolvedValue(false);

        expect(
          await codeOf(() =>
            service.runNow({ scheduleId: "sched_1", actorUserId: "u1" }),
          ),
        ).toBe("schedule_already_in_flight");
      });
    });
  });

  describe("given a slot claimed moments ago", () => {
    describe("when an operator tries to clear it", () => {
      it("refuses, because it is still current", async () => {
        const { service, repo } = makeService(
          record({ currentSlot: at(-1_000), updatedAt: at(-1_000) }),
        );

        expect(
          await codeOf(() =>
            service.clearStuckSlot({
              scheduleId: "sched_1",
              actorUserId: "u1",
              now: NOW,
            }),
          ),
        ).toBe("schedule_slot_not_stale");
        expect(repo.releaseSlotForOps).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a schedule with no slot in flight", () => {
    it("refuses to clear anything", async () => {
      const { service } = makeService(record({ currentSlot: null }));

      expect(
        await codeOf(() =>
          service.clearStuckSlot({
            scheduleId: "sched_1",
            actorUserId: "u1",
            now: NOW,
          }),
        ),
      ).toBe("schedule_slot_not_stale");
    });
  });

  describe("given a slot held past the staleness threshold", () => {
    describe("when an operator clears it", () => {
      it("releases it so the schedule can be claimed again", async () => {
        const { service, repo } = makeService(
          record({
            currentSlot: at(-SLOT_STALE_AFTER_MS - 60_000),
            updatedAt: at(-SLOT_STALE_AFTER_MS - 60_000),
          }),
        );

        await service.clearStuckSlot({
          scheduleId: "sched_1",
          actorUserId: "u1",
          now: NOW,
        });

        expect(repo.releaseSlotForOps).toHaveBeenCalledWith(
          expect.objectContaining({ id: "sched_1", now: NOW }),
        );
      });

      it("records the repair", async () => {
        const { service, audit } = makeService(
          record({
            currentSlot: at(-SLOT_STALE_AFTER_MS - 60_000),
            updatedAt: at(-SLOT_STALE_AFTER_MS - 60_000),
          }),
        );

        await service.clearStuckSlot({
          scheduleId: "sched_1",
          actorUserId: "u1",
          now: NOW,
        });

        expect(audit.append).toHaveBeenCalledWith(
          expect.objectContaining({ action: "ops.scheduler.clear_slot" }),
        );
      });
    });
  });

  describe("given an operator pauses a schedule", () => {
    it("marks it inactive without touching an in-flight slot", async () => {
      const { service, repo } = makeService(
        record({ currentSlot: at(-1_000) }),
      );

      await service.setActive({
        scheduleId: "sched_1",
        active: false,
        actorUserId: "u1",
      });

      expect(repo.setActiveForOps).toHaveBeenCalledWith({
        id: "sched_1",
        active: false,
      });
      expect(repo.releaseSlotForOps).not.toHaveBeenCalled();
    });

    it("records pause and resume distinctly", async () => {
      const { service, audit } = makeService(record());

      await service.setActive({
        scheduleId: "sched_1",
        active: false,
        actorUserId: "u1",
      });
      await service.setActive({
        scheduleId: "sched_1",
        active: true,
        actorUserId: "u1",
      });

      expect(audit.append.mock.calls.map((c) => c[0].action)).toEqual([
        "ops.scheduler.pause",
        "ops.scheduler.resume",
      ]);
    });
  });

  describe("given the audit sink is failing", () => {
    describe("when a control succeeds", () => {
      it("does not report a failure that did not happen", async () => {
        // The mutation already landed; throwing here would invite the operator
        // to do it twice.
        const { service, audit } = makeService(record());
        audit.append.mockRejectedValue(new Error("audit down"));

        await expect(
          service.runNow({
            scheduleId: "sched_1",
            actorUserId: "u1",
            now: NOW,
          }),
        ).resolves.toBeDefined();
      });
    });
  });
});
