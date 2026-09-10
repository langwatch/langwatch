import type { PlatformHealthCheckName } from "@langwatch/platform-health-contract";
import { describe, expect, it } from "vitest";

import {
  SubsystemProbeAdapter,
  type SubsystemProbeRunner,
} from "../subsystem-probe-run.service.ts";
import { SubsystemProbe, type SubsystemProbeResult } from "../../app/platform-health.members.ts";
import { PlatformHealthService } from "../platform-health.service.ts";
import type { SubsystemProbeOutcome } from "../subsystem-probe.service.ts";

class StubProbe implements SubsystemProbe {
  constructor(
    readonly name: PlatformHealthCheckName,
    private readonly answer: () => Promise<SubsystemProbeResult>,
  ) {
  }

  run(): Promise<SubsystemProbeResult> {
    return this.answer();
  }
}

const healthy = (name: PlatformHealthCheckName) =>
  new StubProbe(name, async () => ({ outcome: "healthy" }));

/** Every probe run, refusing to run: a test names the one it expects. */
const unreachable = async (): Promise<never> => {
  throw new Error("this probe run was not expected");
};

const unreachableRunner: SubsystemProbeRunner = {
  runCollector: unreachable,
  runEvaluations: unreachable,
  runProcessor: unreachable,
  runTriggers: unreachable,
  runWorkflows: unreachable,
};

describe("given a probe that throws", () => {
  describe("when the platform health is checked", () => {
    /** @scenario "A probe that throws is unhealthy and does not take the others down" */
    it("reports that subsystem unhealthy and still reports every other one", async () => {
      const service = PlatformHealthService.create({
        probes: [
          healthy("collector"),
          new StubProbe("processor", () => {
            throw new Error("connect ECONNREFUSED 10.0.0.4:8123");
          }),
          healthy("workflows"),
        ],
      });

      const report = await service.checkAll({});

      expect(report.status).toBe("unhealthy");
      expect(report.checks.map((check) => [check.name, check.status])).toEqual([
        ["collector", "healthy"],
        ["processor", "unhealthy"],
        ["workflows", "healthy"],
      ]);
      expect(report.checks[1]?.detail).toBe("the probe could not complete");
      expect(report.checks[1]?.detail).not.toContain("10.0.0.4");
    });
  });
});

describe("given every subsystem answers", () => {
  describe("when the platform health is checked", () => {
    it("reports one entry per subsystem, with how long each took", async () => {
      const service = PlatformHealthService.create({
        probes: [healthy("collector"), healthy("evaluations")],
      });

      const report = await service.checkAll({});

      expect(report.status).toBe("healthy");
      expect(report.checks).toHaveLength(2);
      for (const check of report.checks) {
        expect(check.durationMs).toBeGreaterThanOrEqual(0);
        expect(check.detail).toBeUndefined();
      }
      expect(Date.parse(report.checkedAt)).not.toBeNaN();
    });
  });
});

describe("given one named subsystem is asked for", () => {
  describe("when the platform health is checked", () => {
    it("runs that probe alone", async () => {
      let processorRuns = 0;
      const service = PlatformHealthService.create({
        probes: [
          healthy("collector"),
          new StubProbe("processor", async () => {
            processorRuns++;
            return { outcome: "healthy" };
          }),
        ],
      });

      const report = await service.checkOne("processor", {});

      expect(processorRuns).toBe(1);
      expect(report.checks.map((check) => check.name)).toEqual(["processor"]);
    });
  });
});

describe("given a subsystem refused the probe with a message of its own", () => {
  describe("when the platform health is checked", () => {
    /** @scenario "A failure detail never carries the upstream's own words" */
    it("reports our own words for what broke and none of the upstream's", async () => {
      const probes: SubsystemProbeRunner = {
        ...unreachableRunner,
        runWorkflows: async (): Promise<SubsystemProbeOutcome> => ({
          ok: false,
          httpStatus: 500,
          message: 'Failed to run sample workflow: {"error":"lambda arn:aws:secret exploded"}',
          reason: "workflow_refused",
        }),
      };

      const service = PlatformHealthService.create({
        probes: [
          SubsystemProbeAdapter.create({
            name: "workflows",
            probes,
            credential: { authToken: "probe-key", resolveProjectId: async () => "project-1" },
          }),
        ],
      });

      const report = await service.checkAll({ workflowId: "workflow-1" });

      expect(report.status).toBe("unhealthy");
      expect(report.checks[0]?.detail).toBe("the sample workflow did not run");
      expect(report.checks[0]?.detail).not.toContain("lambda");
      expect(report.checks[0]?.detail).not.toContain("arn:aws");
    });
  });
});

describe("given a subsystem the deployment named no target for", () => {
  describe("when the platform health is checked", () => {
    /** @scenario "A subsystem this deployment never pointed anywhere is degraded, not broken" */
    it("reports it as not configured and the platform as degraded", async () => {
      const probes: SubsystemProbeRunner = unreachableRunner;

      const service = PlatformHealthService.create({
        probes: [
          healthy("collector"),
          SubsystemProbeAdapter.create({
            name: "triggers",
            probes,
            credential: { authToken: "probe-key", resolveProjectId: async () => "project-1" },
          }),
        ],
      });

      const report = await service.checkAll({});

      expect(report.checks[1]?.status).toBe("not_configured");
      expect(report.status).toBe("degraded");
    });
  });
});
