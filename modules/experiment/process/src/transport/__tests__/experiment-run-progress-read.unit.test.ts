import { ExperimentRunLoopUnavailableError } from "@langwatch/experiment-contract";
/**
 * @vitest-environment node
 * Reading a run's progress and starting a run are different capabilities: a process with the
 * progress store but no run loop must still answer a poll.
 */
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import { buildExperimentInfrastructure } from "../../app/experiment-composition.build.ts";
import type { ExperimentV3RunLoop } from "../../app/experiment-workbench.members.ts";
import { runLoopOf, runProgressOf } from "../../rules/experiment-run-loop.rules.ts";
import { UnavailableExperimentExecution } from "../../services/experiment.service.ts";

function infrastructure(redis: unknown) {
  // Nothing below the redis member is reached: building the infrastructure
  // only constructs, and a reach for any of them throws on the missing method.
  return buildExperimentInfrastructure({
    prisma: {} as never,
    clickhouse: {} as never,
    redis: redis as never,
    logger: createTestLogger().logger,
    execution: UnavailableExperimentExecution.create(),
    dependencies: {} as never,
  });
}

const store = {
  get: () => Promise.resolve(null),
  set: () => Promise.resolve("OK"),
  del: () => Promise.resolve(1),
};

describe("a process that composes the progress store but starts no runs", () => {
  /** @scenario "Polling a run does not need the run loop that starts one" */
  it("answers the read, and still refuses to start a run", () => {
    const { runLoop } = infrastructure(store);

    expect(runLoop.ports).toBeNull();
    expect(runProgressOf(runLoop)).toBe(runLoop.progress);
    expect(() => runLoopOf(runLoop)).toThrow(ExperimentRunLoopUnavailableError);
  });

  /** @scenario "Run progress is derived from the deployment's own Redis" */
  it("derives the progress store from the redis member", () => {
    expect(infrastructure(store).runLoop.progress).not.toBeNull();
    expect(infrastructure(void 0).runLoop.progress).toBeNull();
  });
});

describe("a process that composed no progress store at all", () => {
  /** @scenario "A read with no progress store refuses by name" */
  it("refuses the read by name", () => {
    const runLoop = { ports: null, progress: null } as unknown as ExperimentV3RunLoop;

    expect(() => runProgressOf(runLoop)).toThrow(ExperimentRunLoopUnavailableError);
  });
});
