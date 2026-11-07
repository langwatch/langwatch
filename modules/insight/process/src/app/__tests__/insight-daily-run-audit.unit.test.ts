/**
 * @vitest-environment node
 * The audit line of a run, over the memory worker: the run settles, and the daily run
 * pipeline's own subscriber writes the line the audit log is handed.
 * @see modules/insight/specs/insight-daily-run-hardening.feature
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  INSIGHT_DAILY_RUN_AUDIT_ACTION,
  INSIGHT_DAILY_RUN_AUDIT_TARGET_KIND,
} from "../../services/insight-daily-run-audit.service.ts";
import {
  answerWith,
  BOARD,
  finding,
  installDailyRuns,
  type InstalledDailyRuns,
  MEMBER,
} from "./insight-daily-run.fixture.ts";
import { onFirstDay, scheduleDriver } from "./insight-daily-schedule.fixture.ts";
import { PROJECT } from "./insight.fixture.ts";

let installed: InstalledDailyRuns;
let schedule: ReturnType<typeof scheduleDriver>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(onFirstDay("07:00"));
  installed = await installDailyRuns();
  installed.world.langy.answer = answerWith([
    finding(),
    finding({ title: "Errors rose on search", tone: "watch" }),
  ]);
  schedule = scheduleDriver(installed);
  await schedule.turnOn();
});

afterEach(async () => {
  vi.useRealTimers();
  await installed.stop();
});

describe("given a run that filed two insights for a member on a board", () => {
  describe("when its outcome is recorded", () => {
    /** @scenario "A settled run writes one audit line for the person it acted for" */
    it("writes one line for the project, naming the member, the board and how it ended", async () => {
      const slot = schedule.slotOf();

      const run = await schedule.runDay({ day: 0 });
      // The outbox may carry the run out twice: its outcome, and so its line, is recorded once.
      await installed.carryOut(run);

      await vi.waitFor(() => expect(installed.auditLines).toHaveLength(1));
      expect(installed.auditLines).toEqual([
        {
          idempotencyKey: expect.stringMatching(/^audit_/),
          userId: MEMBER,
          projectId: PROJECT,
          action: INSIGHT_DAILY_RUN_AUDIT_ACTION,
          targetKind: INSIGHT_DAILY_RUN_AUDIT_TARGET_KIND,
          targetId: installed.scheduleIdOf(),
          metadata: {
            runId: `slot:${slot}`,
            slot,
            board: BOARD,
            outcome: "filed",
            reason: null,
            filedCount: 2,
            renewedCount: 0,
            conversationId: "conversation-1",
          },
        },
      ]);
    });
  });
});

describe("given a member without analytics:view", () => {
  beforeEach(() => {
    installed.world.readers.delete(MEMBER);
  });

  describe("when a run is requested for them", () => {
    /** @scenario "A run skipped before it started writes an audit line too" */
    it("writes one line with the outcome skipped and the reason no_access", async () => {
      await schedule.runDay({ day: 0 });

      await vi.waitFor(() => expect(installed.auditLines).toHaveLength(1));
      expect(installed.auditLines[0]).toMatchObject({
        userId: MEMBER,
        targetId: installed.scheduleIdOf(),
        metadata: {
          outcome: "skipped",
          reason: "no_access",
          filedCount: 0,
          renewedCount: 0,
          conversationId: null,
        },
      });
    });
  });
});
