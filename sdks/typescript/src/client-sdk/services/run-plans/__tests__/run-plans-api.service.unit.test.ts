/**
 * The run plan service.
 *
 * Spec: specs/typescript-sdk/run-plans-and-test-suites.feature
 */
import { describe, expect, it, vi } from "vitest";
import { RunPlansApiError, RunPlansApiService } from "../run-plans-api.service";
import { isLangWatchHandledError } from "@/internal/api/errors";
import type { LangwatchApiClient } from "@/internal/api/client";

/** The flat @langwatch/api envelope: the code sits at the top level. */
const flatNotFound = {
  code: "suite_not_found",
  type: "not_found",
  kind: "suite_not_found",
  message: "Run plan not found.",
  meta: {},
};

const clientWith = (result: {
  data?: unknown;
  error?: unknown;
  response?: Response;
}) => {
  const calls = {
    GET: vi.fn(async (_path: string, _init?: RequestInit) => result),
    POST: vi.fn(async (_path: string, init?: { body?: Record<string, unknown> }) => {
      void init;
      return result;
    }),
    PATCH: vi.fn(async (_path: string, _init?: unknown) => result),
    PUT: vi.fn(async (_path: string, _init?: unknown) => result),
    DELETE: vi.fn(async (_path: string, _init?: unknown) => result),
  };
  return { client: calls as unknown as LangwatchApiClient, calls };
};

const serviceWith = (result: {
  data?: unknown;
  error?: unknown;
  response?: Response;
}) => {
  const { client, calls } = clientWith(result);
  return {
    service: new RunPlansApiService({ langwatchApiClient: client }),
    calls,
  };
};

describe("RunPlansApiService", () => {
  describe("when listing plans", () => {
    /** @scenario "List run plans" */
    it("reads the run plan family, leaving archived plans out", async () => {
      const { service, calls } = serviceWith({ data: [] });

      await service.list();

      expect(calls.GET).toHaveBeenCalledWith("/api/v1/run-plans", {});
    });

    /** @scenario "List run plans including archived" */
    it("asks for archived plans when told to", async () => {
      const { service, calls } = serviceWith({ data: [] });

      await service.list({ includeArchived: true });

      expect(calls.GET).toHaveBeenCalledWith("/api/v1/run-plans", {
        params: { query: { includeArchived: "true" } },
      });
    });
  });

  describe("when reading one plan", () => {
    /** @scenario "Read one run plan" */
    it("reads it by id", async () => {
      const { service, calls } = serviceWith({ data: { id: "plan_abc" } });

      await service.get("plan_abc");

      expect(calls.GET).toHaveBeenCalledWith("/api/v1/run-plans/{id}", {
        params: { path: { id: "plan_abc" } },
      });
    });
  });

  describe("when running a configuration", () => {
    /** @scenario "Run a configuration" */
    it("posts it, and answers with the plan it was filed under", async () => {
      const answer = {
        scheduled: true,
        batchRunId: "batch_1",
        setId: "set_1",
        jobCount: 2,
        skippedArchived: { scenarios: [], targets: [] },
        items: [],
        runPlanId: "plan_abc",
        planName: "Nightly regression",
        created: false,
        platformUrl: "https://app.langwatch.ai/proj-1/agent-testing/results",
      };
      const { service, calls } = serviceWith({ data: answer });

      const result = await service.run({
        name: "Nightly regression",
        config: {
          scope: { mode: "all" },
          targets: [{ type: "http", referenceId: "agent_abc" }],
        },
      });

      expect(calls.POST).toHaveBeenCalledWith("/api/v1/run-plans/run", {
        body: {
          name: "Nightly regression",
          config: {
            scope: { mode: "all" },
            targets: [{ type: "http", referenceId: "agent_abc" }],
          },
        },
      });
      expect(result).toMatchObject({
        runPlanId: "plan_abc",
        planName: "Nightly regression",
        created: false,
      });
    });

    /** @scenario "Run a configuration with a note of only spaces" */
    it("sends no note when the note holds only spaces", async () => {
      const { service, calls } = serviceWith({ data: {} });

      await service.run({
        config: {
          scope: { mode: "all" },
          targets: [{ type: "http", referenceId: "agent_abc" }],
        },
        note: "   ",
      });

      expect(calls.POST.mock.calls[0]?.[1]?.body ?? {}).not.toHaveProperty("note");
    });
  });

  describe("when running a plan again", () => {
    /** @scenario "Run a plan again with the configuration it already holds" */
    it("posts to the plan's own run route, with no configuration", async () => {
      const { service, calls } = serviceWith({ data: {} });

      await service.rerun("plan_abc", { note: "nightly" });

      expect(calls.POST).toHaveBeenCalledWith("/api/v1/run-plans/{id}/run", {
        params: { path: { id: "plan_abc" } },
        body: { note: "nightly" },
      });
      expect(calls.POST.mock.calls[0]?.[1]?.body ?? {}).not.toHaveProperty("config");
    });
  });

  describe("when archiving a plan", () => {
    /** @scenario "Archive a run plan" */
    it("sends a delete", async () => {
      const { service, calls } = serviceWith({
        data: { id: "plan_abc", archived: true },
      });

      await service.archive("plan_abc");

      expect(calls.DELETE).toHaveBeenCalledWith("/api/v1/run-plans/{id}", {
        params: { path: { id: "plan_abc" } },
      });
    });
  });

  describe("when the platform names the failure in the flat envelope", () => {
    /** @scenario "The platform names the failure in the flat envelope" */
    it("raises the typed handled error with the platform's own code and status", async () => {
      const { service } = serviceWith({
        error: flatNotFound,
        response: new Response(null, { status: 404 }),
      });

      const thrown = await service.get("plan_abc").then(
        () => {
          throw new Error("expected get to reject");
        },
        (error: unknown) => error,
      );

      expect(isLangWatchHandledError(thrown)).toBe(true);
      expect(thrown).toMatchObject({
        code: "suite_not_found",
        httpStatus: 404,
      });
    });
  });

  describe("when the failure body is not the platform's shape", () => {
    /** @scenario "The failure body is not the platform's shape" */
    it("throws the family's own error, status attached", async () => {
      const { service } = serviceWith({
        error: "<html>bad gateway</html>",
        response: new Response(null, { status: 502 }),
      });

      const thrown = await service.list().then(
        () => {
          throw new Error("expected list to reject");
        },
        (error: unknown) => error,
      );

      expect(isLangWatchHandledError(thrown)).toBe(false);
      expect(thrown).toBeInstanceOf(RunPlansApiError);
      expect((thrown as RunPlansApiError).status).toBe(502);
    });
  });
});
