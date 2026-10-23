import { afterEach, describe, expect, it, vi } from "vitest";

import { EvaluationExecutionIntentService } from "../features/execution/services/evaluation-execution-intent.service.ts";
import {
  buildExecuteCommand,
  buildExecutionDeps,
  buildMonitor,
} from "./support/evaluation-execution.fixtures.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const SKIPPED = expect.objectContaining({
  type: "lw.evaluation.reported",
  data: expect.objectContaining({ status: "skipped" }),
});

describe("a retried evaluation", () => {
  /** @scenario "A retried evaluation always ends with a result" */
  it("does not roll the sampling dice again on attempt 2", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const deps = buildExecutionDeps({ monitor: buildMonitor({ sample: 0.5 }) });

    const events = await EvaluationExecutionIntentService.create(deps).handle(
      buildExecuteCommand({ attempt: 2 }),
    );

    expect(deps.evaluations.executeForTrace).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "lw.evaluation.reported",
        data: expect.objectContaining({ status: "processed" }),
      }),
    );
  });

  /** @scenario "A retried evaluation always ends with a result" */
  it("still drops silently on a first attempt excluded by sampling", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const deps = buildExecutionDeps({ monitor: buildMonitor({ sample: 0.5 }) });

    const events =
      await EvaluationExecutionIntentService.create(deps).handle(buildExecuteCommand());

    expect(events).toEqual([]);
  });

  /** @scenario "A retried evaluation always ends with a result" */
  it("is reported as skipped when a precondition is no longer met on attempt 2", async () => {
    const deps = buildExecutionDeps({
      monitor: buildMonitor({
        preconditions: [{ field: "input", rule: "contains", value: "hello" }],
      }),
    });

    const events = await EvaluationExecutionIntentService.create(deps).handle(
      buildExecuteCommand({ attempt: 2 }),
    );

    expect(events).toEqual([SKIPPED]);
    expect(deps.evaluations.executeForTrace).not.toHaveBeenCalled();
  });

  /** @scenario "A retried evaluation always ends with a result" */
  it("is reported as skipped when its monitor was deleted before attempt 2", async () => {
    const deps = buildExecutionDeps({ monitor: null });

    const events = await EvaluationExecutionIntentService.create(deps).handle(
      buildExecuteCommand({ attempt: 2 }),
    );

    expect(events).toEqual([SKIPPED]);
  });
});
