/**
 * Whether the worker stages the retry the scenario package decided, or one of
 * its own.
 *
 * The retry used to arrive with the composed capability, synthesized in
 * platform/app; the description belongs to `@langwatch/scenario-server` now and
 * the installer reads it. That is only a move while the registration keeps
 * carrying the package's own routing key, delay and deduplication into the
 * queue — a job registered under a name the other consumer never staged, or
 * with a deduplication id of the installer's own devising, registers cleanly
 * and then quietly never runs.
 *
 * Spec: packages/features/scenario/specs/simulation-service.feature
 */
import {
  COMPUTE_METRICS_RETRY_DELAY_MS,
  scenarioDeferredComputeRunMetricsJob,
} from "@langwatch/scenario-server";
import { describe, expect, it, vi } from "vitest";

import type { WorkerEventingRuntime } from "../../../platform/eventing/worker-eventing.runtime";
import { ScenarioWorkerFeatureInstaller } from "../scenario-worker-feature.installer";

type JobConfig = {
  name: string;
  delay?: number;
  process(payload: Record<string, unknown>): Promise<void>;
  deduplication?: { makeId(payload: Record<string, unknown>): string };
  spanAttributes?(payload: Record<string, unknown>): Record<string, unknown>;
};

/** The retry payload as the metrics command reschedules it. */
const payload = {
  tenantId: "tenant-1",
  scenarioRunId: "run-1",
  traceId: "trace-1",
  retryCount: 1,
  occurredAt: 1_700_000_000_000,
};

function eventingDouble() {
  const jobs: JobConfig[] = [];
  const dispatched: unknown[] = [];
  const queued: unknown[] = [];
  const eventing = {
    eventSourcing: {
      register: () => ({
        commands: {
          computeRunMetrics: { send: async (data: unknown) => void dispatched.push(data) },
        },
        service: {
          registerJob: (config: JobConfig) => {
            jobs.push(config);
            return { send: async (data: unknown) => void queued.push(data) };
          },
        },
      }),
    },
  } as unknown as WorkerEventingRuntime;
  return { eventing, jobs, dispatched, queued };
}

async function install(eventing: WorkerEventingRuntime, connect = vi.fn()) {
  await ScenarioWorkerFeatureInstaller.create({
    installer: { buildProcessing: () => ({}) as never, connect },
    eventing,
  }).install();
  return connect;
}

describe("the scenario worker feature", () => {
  describe("given a graph whose queue the legacy registry also stages", () => {
    describe("when the feature installs", () => {
      /** @scenario "The worker stages the retry the scenario package decided" */
      it("registers the package's routing key and delay", async () => {
        const { eventing, jobs } = eventingDouble();

        await install(eventing);

        expect(jobs.map((job) => [job.name, job.delay])).toEqual([
          [scenarioDeferredComputeRunMetricsJob.name, COMPUTE_METRICS_RETRY_DELAY_MS],
        ]);
      });

      /** @scenario "Retries of one run deduplicate onto one queue entry" */
      it("deduplicates by the package's job id rather than one of its own", async () => {
        const { eventing, jobs } = eventingDouble();

        await install(eventing);

        expect(jobs[0]?.deduplication?.makeId(payload)).toBe(
          scenarioDeferredComputeRunMetricsJob.makeJobId(payload),
        );
      });

      /** @scenario "The delayed metrics retry keeps one routing key across both graphs" */
      it("reports the retry under the package's span attributes", async () => {
        const { eventing, jobs } = eventingDouble();

        await install(eventing);

        expect(jobs[0]?.spanAttributes?.(payload)).toEqual(
          scenarioDeferredComputeRunMetricsJob.spanAttributes(payload),
        );
      });

      /** @scenario "The worker stages the retry the scenario package decided" */
      it("replays a due retry into the run's own metrics command", async () => {
        const { eventing, jobs, dispatched } = eventingDouble();

        await install(eventing);
        await jobs[0]?.process(payload);

        expect(dispatched).toEqual([payload]);
      });

      /** @scenario "The worker stages the retry the scenario package decided" */
      it("hands the run's scheduler the queue it just registered", async () => {
        const { eventing, queued } = eventingDouble();

        const connect = await install(eventing);
        await connect.mock.calls[0]?.[0]?.scheduleComputeRunMetricsRetry(payload);

        expect(queued).toEqual([payload]);
      });
    });
  });
});
