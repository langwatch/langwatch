import { describe, expect, it, vi } from "vitest";
import { WorkerEventingRuntime } from "../../../platform/eventing/worker-eventing.runtime";
import {
  AutomationWorkerFeatureInstaller,
  type AutomationReportSchedule,
} from "../automation-worker-feature.installer";

/**
 * The one registration this installer makes, stubbed.
 *
 * What the suite observes is the report calendar's lifecycle, not the pipeline
 * registration — that is the eventing package's own contract, and is pinned by
 * `worker-feature-registration-order`.
 */
function createEventing(): WorkerEventingRuntime {
  const eventing = WorkerEventingRuntime.create({
    eventStore: { append: async () => undefined } as never,
    queueFactory: () => ({ close: async () => undefined }) as never,
    processStore: { close: async () => undefined } as never,
    executionTarget: "worker",
    warnWhenProjectionsRunInline: false,
    consumers: { enabled: false },
  });
  vi.spyOn(eventing.eventSourcing, "register").mockImplementation(
    () =>
      ({
        commands: { recordTriggerMatch: { send: async () => undefined } },
      }) as never,
  );
  return eventing;
}

function createInstaller(reportSchedule?: AutomationReportSchedule) {
  return AutomationWorkerFeatureInstaller.create({
    installer: {
      buildPipeline: () =>
        ({ metadata: { name: "automations", aggregateType: "global" } }) as never,
    },
    eventing: createEventing(),
    ...(reportSchedule ? { reportSchedule } : {}),
  });
}

describe("AutomationWorkerFeatureInstaller", () => {
  describe("given a process that composed a report calendar", () => {
    it("runs it for as long as the feature is installed", async () => {
      const start = vi.fn();
      const stop = vi.fn(async () => {});
      const installer = createInstaller({ start, stop });

      const closer = await installer.install();
      expect(start).toHaveBeenCalledTimes(1);
      expect(stop).not.toHaveBeenCalled();

      expect(closer).toBeDefined();
      await closer!();
      expect(stop).toHaveBeenCalledTimes(1);
    });

    it("starts it once however often the feature is installed", async () => {
      const start = vi.fn();
      const installer = createInstaller({ start, stop: async () => {} });

      await installer.install();
      await installer.install();

      // A second start would put two loops on one fleet's calendar, and both
      // would race the same lease for no gain.
      expect(start).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a process that composed no report calendar", () => {
    it("installs with nothing to close", async () => {
      const installer = createInstaller();

      const closer = await installer.install();

      expect(closer).toBeUndefined();
    });
  });
});
