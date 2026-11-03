import { ProjectNotFoundError } from "@langwatch/authorization";
import { HandledError } from "@langwatch/handled-error";
import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { createTestLogger } from "@langwatch/test-harness";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { completeWhenProjectGone } from "../groupQueueFactory.ts";

/** Spec: specs/eventing/deleted-project-jobs.feature */

const QUEUE = "{event-sourcing/jobs}";
const TENANT = "project_gone";

const job = (jobType: string) => ({
  __pipelineName: "pipeline",
  __jobType: jobType,
  __jobName: "lane",
  tenantId: TENANT,
});

/** Shaped as project's contract refusal: a handled error recognised by its code. */
class ProjectContractNotFound extends HandledError {
  constructor() {
    super("project_not_found", "Project not found", { httpStatus: 404 });
  }
}
const projectContractRefusal = () => new ProjectContractNotFound();

describe("completeWhenProjectGone", () => {
  let meter = createRecordingMeterProvider();
  let testLog = createTestLogger();
  beforeEach(() => {
    meter = createRecordingMeterProvider();
    meter.install();
    testLog = createTestLogger();
  });
  afterEach(() => {
    meter.uninstall();
  });

  const warnings = () => testLog.lines.filter((line) => line.level === 40);

  const goneCount = (jobType: string) =>
    meter.valueOf("es_jobs_project_gone_total", { queue: QUEUE, job_type: jobType });

  describe.each([
    { kind: "command", jobType: "command", error: () => new ProjectNotFoundError(TENANT) },
    {
      kind: "fold projection",
      jobType: "projection",
      error: () => new ProjectNotFoundError(TENANT),
    },
    { kind: "map projection", jobType: "map", error: projectContractRefusal },
    { kind: "subscriber", jobType: "subscriber", error: projectContractRefusal },
    {
      kind: "process manager",
      jobType: "handler",
      error: () => new Error("turn failed", { cause: new ProjectNotFoundError(TENANT) }),
    },
  ])("given a $kind job whose project no longer exists", ({ jobType, error }) => {
    /** @scenario "A <kind> job whose project no longer exists completes as a no-op" */
    it("completes it with one warning naming its tenant, queue and job type", async () => {
      await expect(
        completeWhenProjectGone({
          queueName: QUEUE,
          payloads: [job(jobType)],
          run: () => Promise.reject(error()),
          log: testLog.logger,
        }),
      ).resolves.toBeUndefined();

      expect(warnings()).toHaveLength(1);
      expect(testLog.lines.findLine("warn", "no longer exists")).toEqual(
        expect.objectContaining({ tenantId: TENANT, queueName: QUEUE, jobType }),
      );
    });
  });

  describe("given a coalesced batch whose project no longer exists", () => {
    /** @scenario "A coalesced batch whose project no longer exists completes as a no-op" */
    it("completes the whole batch with one warning", async () => {
      await expect(
        completeWhenProjectGone({
          queueName: QUEUE,
          payloads: [job("projection"), job("projection"), job("projection")],
          run: () => Promise.reject(new ProjectNotFoundError(TENANT)),
          log: testLog.logger,
        }),
      ).resolves.toBeUndefined();

      expect(warnings()).toHaveLength(1);
      expect(warnings()[0]).toEqual(expect.objectContaining({ tenantId: TENANT, jobs: 3 }));
    });

    /** @scenario "A job or outbox message completed because its project is gone is counted" */
    it("counts every job in the batch under its queue and job type", async () => {
      await completeWhenProjectGone({
        queueName: QUEUE,
        payloads: [job("projection"), job("projection"), job("projection")],
        run: () => Promise.reject(new ProjectNotFoundError(TENANT)),
        log: testLog.logger,
      });

      expect(goneCount("projection")).toBe(3);
    });
  });

  describe("given a job that fails for any other reason", () => {
    /** @scenario "A job that fails for any other reason is still retried" */
    it("rethrows the failure unchanged so the queue retries it", async () => {
      const transient = new Error("clickhouse down");

      await expect(
        completeWhenProjectGone({
          queueName: QUEUE,
          payloads: [job("projection")],
          run: () => Promise.reject(transient),
          log: testLog.logger,
        }),
      ).rejects.toBe(transient);
      expect(warnings()).toEqual([]);
      expect(goneCount("projection")).toBe(0);
    });
  });
});
