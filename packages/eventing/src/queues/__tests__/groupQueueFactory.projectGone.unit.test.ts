import { ProjectNotFoundError } from "@langwatch/authorization";
import { HandledError } from "@langwatch/handled-error";
import type * as observabilityModule from "@langwatch/observability";
import { afterEach, describe, expect, it, vi } from "vitest";

// Capture the factory's own logger so the no-op can be asserted to warn.
const { warnSpy } = vi.hoisted(() => ({ warnSpy: vi.fn() }));
vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof observabilityModule>();
  return {
    ...actual,
    createLogger: () => ({ warn: warnSpy, error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  };
});

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
  afterEach(() => {
    vi.clearAllMocks();
  });

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
        }),
      ).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT, queueName: QUEUE, jobType }),
        expect.stringContaining("no longer exists"),
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
        }),
      ).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT, jobs: 3 }),
        expect.any(String),
      );
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
        }),
      ).rejects.toBe(transient);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
