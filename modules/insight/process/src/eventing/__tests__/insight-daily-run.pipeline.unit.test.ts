/**
 * @vitest-environment node
 * The pipeline declares one queue per schedule for a run's start and its outcome; assert the
 * registration, so a lane that went inert is caught (ADR-004).
 * @see modules/insight/specs/insight-daily-run.feature
 */

import { describe, expect, it } from "vitest";

import { buildInsightDailyRunPipeline } from "../insight-daily-run.pipeline.ts";

function commandNamed(name: string) {
  const pipeline = buildInsightDailyRunPipeline({
    scheduleStore: {} as never,
    runInFlightStore: {} as never,
    runs: {} as never,
    reconcile: {} as never,
    audit: {} as never,
    cleanup: {} as never,
  });
  const entry = pipeline.commands.find((command) => command.definition.name === name);
  if (!entry) throw new Error(`no command registered as "${name}"`);
  return entry;
}

/** A lost run's outcome that a run records must land before that run's own start. */
const RUN_COMMANDS = ["recordRunStarted", "settleRun"] as const;

describe("given the daily run pipeline", () => {
  describe("when the commands that record a run's start and outcome are registered", () => {
    /** @scenario "A run's start and its outcome share one queue per schedule" */
    it.each(RUN_COMMANDS)("%s serializes on the schedule, with no lane override", (name) => {
      const { options } = commandNamed(name).definition;

      expect(options?.serializeByAggregate).toBe(true);
      expect(options?.getGroupKey).toBeUndefined();
    });
  });
});
