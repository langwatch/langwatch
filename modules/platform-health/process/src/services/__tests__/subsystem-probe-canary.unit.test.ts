/**
 * A canary the platform does not take is the platform's failure: it leaves as
 * a handled error an alert can name, never as an anonymous 500.
 * @see specs/ops/health-probe-failures.feature
 */
import { HandledError } from "@langwatch/handled-error";
import { HealthCheckFailedError } from "@langwatch/platform-health-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { logger } = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => logger,
}));

import { MemorySubsystemProbeChannel } from "../../channels/memory/memory.subsystem-probe.channel.ts";
import type {
  SubsystemProbeChannel,
  SubsystemProbeRequest,
} from "../../channels/subsystem-probe.channel.ts";
import { SubsystemProbeRunService } from "../subsystem-probe-run.service.ts";
import { SubsystemProbeService } from "../subsystem-probe.service.ts";

const CREDENTIAL = { authToken: "token", projectId: "project_1", signal: undefined } as const;

function probes(canaries: SubsystemProbeChannel) {
  return SubsystemProbeService.create({
    collaborators: {
      canaries,
      automation: () => ({ findById: async () => null, getRecentFires: async () => [] }),
      workflowExists: async () => true,
    },
  });
}

/** A boundary whose every canary POST fails the way the network does. */
function unreachable(cause: Error): SubsystemProbeChannel {
  return {
    post: () => Promise.reject(cause),
    get: () => Promise.reject(cause),
  };
}

/** A boundary that holds every canary POST open until the probe abandons it. */
function wedged(received: AbortSignal[]): SubsystemProbeChannel {
  return {
    post: ({ signal }: SubsystemProbeRequest) =>
      new Promise<Response>((_resolve, reject) => {
        if (!signal) return;
        received.push(signal);
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    get: () => Promise.reject(new Error("not used")),
  };
}

describe("a probe sending a canary", () => {
  beforeEach(() => {
    logger.error.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when the canary POST fails at the network level", () => {
    /** @scenario "A canary the collector never answers is reported as our failure" */
    it("fails with the health check code, attributed to the platform", async () => {
      const failed = await probes(unreachable(new Error("connect ECONNREFUSED")))
        .runCollector(CREDENTIAL)
        .catch((error: unknown) => error);

      expect(HandledError.isHandled(failed)).toBe(true);
      const handled = failed as HandledError;
      expect(handled.code).toBe("health_check_failed");
      expect(handled.fault).toBe("platform");
      expect(handled.httpStatus).toBe(500);
      expect(handled.meta).toMatchObject({ check: "collector" });
      expect(["rest", "otlp"]).toContain(handled.meta.transport);
    });

    /** @scenario "The cause of a transport failure survives in the log" */
    it("logs the underlying cause, which the wire would otherwise mask", async () => {
      const cause = new Error("connect ECONNREFUSED");

      await probes(unreachable(cause))
        .runCollector(CREDENTIAL)
        .catch(() => undefined);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ probe: "collector", error: cause }),
        expect.stringContaining("transport failed"),
      );
    });
  });

  describe("when our own boundary refuses the canary", () => {
    /** @scenario "A canary our own boundary refuses names the status it was refused with" */
    it("carries the upstream status for the alert to read", async () => {
      const canaries = MemorySubsystemProbeChannel.create({
        answer: () => new Response("{}", { status: 503 }),
      });

      const failed = await probes(canaries)
        .runProcessor(CREDENTIAL)
        .catch((error: unknown) => error);

      expect(failed).toBeInstanceOf(HealthCheckFailedError);
      const handled = failed as HealthCheckFailedError;
      expect(handled.code).toBe("health_check_failed");
      expect(handled.meta).toMatchObject({ check: "processor", upstreamStatus: 503 });
      expect(["rest", "otlp"]).toContain(handled.meta.transport);
    });
  });

  describe("when the boundary never answers", () => {
    /** @scenario "A canary that hangs is not waited on forever" */
    it("abandons the request after thirty seconds and fails the probe", async () => {
      vi.useFakeTimers();
      const received: AbortSignal[] = [];

      const outcome = probes(wedged(received))
        .runCollector(CREDENTIAL)
        .catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(29_999);
      expect(received.every((signal) => !signal.aborted)).toBe(true);
      await vi.advanceTimersByTimeAsync(1);

      expect(received).toHaveLength(2);
      expect(received.every((signal) => signal.aborted)).toBe(true);
      expect(await outcome).toBeInstanceOf(HealthCheckFailedError);
    });
  });

  describe("when the monitoring family runs a refused collector", () => {
    it("reports our own words for the refusal, not a thrown probe", async () => {
      const canaries = MemorySubsystemProbeChannel.create({
        answer: () => new Response("{}", { status: 503 }),
      });
      const run = SubsystemProbeRunService.create({
        name: "collector",
        probes: probes(canaries),
        credential: { authToken: "token", findProjectIds: async () => ["project_1"] },
      });

      await expect(run.run({ signal: undefined })).resolves.toMatchObject({
        outcome: "unhealthy",
        detail: expect.stringContaining("did not accept the canary trace"),
      });
    });
  });
});
