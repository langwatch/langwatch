import { beforeEach, describe, expect, it, vi } from "vitest";

// A unit test living beside the e2e scenarios it serves, deliberately: it
// exercises the RUNNER, not a scenario, so it must not need a live agent, a
// judge, or a browser. The `.unit.test.ts` suffix keeps it in the unit run —
// `vitest.config.ts` excludes `*.scenario.test.ts`, not this directory.
//
// What is pinned here is the `beforeRetry` contract. The retry replays the
// WHOLE scenario, so a scenario whose write cannot simply be repeated (the
// motivating case is deletion) rebuilds its world state through this hook.
// Getting the ORDER wrong — replaying before re-seeding — would leave the
// second attempt asking Langy to delete something that is already gone and
// fail the judge for work the first attempt did correctly. That is a silent,
// intermittent failure that only appears when infrastructure flakes, which is
// exactly the kind of thing no scenario run would reliably catch.

const scenarioRun = vi.hoisted(() => vi.fn());
const isTransient = vi.hoisted(() => vi.fn());

vi.mock("@langwatch/scenario", () => ({ run: scenarioRun }));
vi.mock("./langy-agent", () => ({
  isTransientInfrastructureError: isTransient,
}));
// The QA pass and the disk log are best-effort side effects the runner already
// swallows; stubbed so this test neither drives a browser nor writes files.
vi.mock("./browser-qa", () => ({ browserQA: vi.fn().mockResolvedValue(null) }));
vi.mock("node:fs", () => ({
  promises: { mkdir: vi.fn(), writeFile: vi.fn() },
}));

import { runScenarioAndLog } from "./scenario-logger";

const CONFIG = { name: "a scenario" } as Parameters<typeof runScenarioAndLog>[0]["config"];

describe("runScenarioAndLog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTransient.mockReturnValue(false);
  });

  describe("when the run hits a transient infrastructure failure", () => {
    beforeEach(() => {
      isTransient.mockReturnValue(true);
    });

    it("re-seeds through beforeRetry BEFORE replaying, not after", async () => {
      // The whole point of the hook. Recorded as a call ORDER rather than two
      // independent "was called" assertions, because a hook that fires after
      // the replay would satisfy both of those and still be useless.
      const order: string[] = [];
      scenarioRun
        .mockImplementationOnce(() => {
          order.push("attempt-1");
          return Promise.reject(new Error("worker died"));
        })
        .mockImplementationOnce(() => {
          order.push("attempt-2");
          return Promise.resolve({ success: true });
        });

      await runScenarioAndLog({
        config: CONFIG,
        beforeRetry: async () => {
          order.push("beforeRetry");
        },
      });

      expect(order).toEqual(["attempt-1", "beforeRetry", "attempt-2"]);
    });

    it("still retries when no beforeRetry is supplied", async () => {
      // Back-compat for the 50+ existing call sites, which pass no options at
      // all: the hook is optional and its absence must not swallow the retry.
      scenarioRun
        .mockRejectedValueOnce(new Error("worker died"))
        .mockResolvedValueOnce({ success: true });

      const result = await runScenarioAndLog({ config: CONFIG });

      expect(scenarioRun).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ success: true });
    });
  });

  it("does not run beforeRetry when the first attempt succeeds", async () => {
    // A re-seed on the happy path would be a spurious extra write — for the
    // deletion scenario, it would leave an orphan evaluator behind.
    const beforeRetry = vi.fn();
    scenarioRun.mockResolvedValueOnce({ success: true });

    await runScenarioAndLog({ config: CONFIG, beforeRetry });

    expect(beforeRetry).not.toHaveBeenCalled();
    expect(scenarioRun).toHaveBeenCalledTimes(1);
  });

  it("does not run beforeRetry when the failure is not transient", async () => {
    // A genuine agent/library error is rethrown untouched. Re-seeding there
    // would mutate the world on the way out of a failing test and muddy the
    // state a human is about to inspect.
    const beforeRetry = vi.fn();
    isTransient.mockReturnValue(false);
    scenarioRun.mockRejectedValueOnce(new Error("real bug"));

    await expect(runScenarioAndLog({ config: CONFIG, beforeRetry })).rejects.toThrow("real bug");

    expect(beforeRetry).not.toHaveBeenCalled();
    expect(scenarioRun).toHaveBeenCalledTimes(1);
  });
});
