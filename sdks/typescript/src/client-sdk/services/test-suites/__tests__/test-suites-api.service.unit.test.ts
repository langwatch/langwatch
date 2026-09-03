/**
 * The test suite service.
 *
 * Spec: specs/typescript-sdk/run-plans-and-test-suites.feature
 */
import { describe, expect, it, vi } from "vitest";
import {
  TestSuitesApiError,
  TestSuitesApiService,
} from "../test-suites-api.service";
import { isLangWatchHandledError } from "@/internal/api/errors";
import type { LangwatchApiClient } from "@/internal/api/client";
import { LangWatch } from "@/client-sdk/index";
import { RunPlansApiService } from "@/client-sdk/services/run-plans";
import { SuitesApiService } from "@/client-sdk/services/suites";

/** The 401 envelope: the failure nested under `error`. */
const nestedUnauthorized = {
  error: {
    type: "unauthorized",
    code: "invalid_api_key",
    message: "The API key is not valid.",
  },
};

const serviceWith = (result: {
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
  return {
    service: new TestSuitesApiService({
      langwatchApiClient: calls as unknown as LangwatchApiClient,
    }),
    calls,
  };
};

describe("TestSuitesApiService", () => {
  describe("when listing suites", () => {
    /** @scenario "List test suites" */
    it("reads the test suite family", async () => {
      const { service, calls } = serviceWith({ data: [] });

      await service.list();

      expect(calls.GET).toHaveBeenCalledWith("/api/v1/test-suites", {});
    });
  });

  describe("when creating a suite", () => {
    /** @scenario "Create a test suite" */
    it("posts only the name", async () => {
      const { service, calls } = serviceWith({ data: { id: "suite_abc" } });

      await service.create({ name: "Refunds" });

      expect(calls.POST).toHaveBeenCalledWith("/api/v1/test-suites", {
        body: { name: "Refunds" },
      });
    });
  });

  describe("when reading one suite", () => {
    /** @scenario "Read one test suite" */
    it("reads it by id, with its scenarios named", async () => {
      const { service, calls } = serviceWith({
        data: {
          id: "suite_abc",
          scenarios: [{ id: "scenario_1", name: "Refund a paid order" }],
        },
      });

      const suite = await service.get("suite_abc");

      expect(calls.GET).toHaveBeenCalledWith("/api/v1/test-suites/{id}", {
        params: { path: { id: "suite_abc" } },
      });
      expect(suite.scenarios).toEqual([
        { id: "scenario_1", name: "Refund a paid order" },
      ]);
    });
  });

  describe("when renaming a suite", () => {
    /** @scenario "Rename a test suite" */
    it("patches the name", async () => {
      const { service, calls } = serviceWith({ data: { id: "suite_abc" } });

      await service.rename("suite_abc", { name: "Refunds and credits" });

      expect(calls.PATCH).toHaveBeenCalledWith("/api/v1/test-suites/{id}", {
        params: { path: { id: "suite_abc" } },
        body: { name: "Refunds and credits" },
      });
    });
  });

  describe("when archiving a suite", () => {
    /** @scenario "Archive a test suite" */
    it("sends a delete", async () => {
      const { service, calls } = serviceWith({
        data: { id: "suite_abc", archived: true },
      });

      await service.archive("suite_abc");

      expect(calls.DELETE).toHaveBeenCalledWith("/api/v1/test-suites/{id}", {
        params: { path: { id: "suite_abc" } },
      });
    });
  });

  describe("when running a suite", () => {
    /** @scenario "Run a test suite" */
    it("posts the targets to the suite's own run route", async () => {
      const { service, calls } = serviceWith({ data: {} });

      await service.run("suite_abc", {
        targets: [{ type: "http", referenceId: "agent_abc" }],
      });

      expect(calls.POST).toHaveBeenCalledWith("/api/v1/test-suites/{id}/run", {
        params: { path: { id: "suite_abc" } },
        body: { targets: [{ type: "http", referenceId: "agent_abc" }] },
      });
    });

    it("drops a note that holds only spaces", async () => {
      const { service, calls } = serviceWith({ data: {} });

      await service.run("suite_abc", {
        targets: [{ type: "http", referenceId: "agent_abc" }],
        note: "   ",
      });

      expect(calls.POST.mock.calls[0]?.[1]?.body ?? {}).not.toHaveProperty("note");
    });
  });

  describe("when the platform names the failure in the nested envelope", () => {
    /** @scenario "The platform names the failure in the nested envelope" */
    it("raises the typed handled error with the platform's own code and status", async () => {
      const { service } = serviceWith({
        error: nestedUnauthorized,
        response: new Response(null, { status: 401 }),
      });

      const thrown = await service.list().then(
        () => {
          throw new Error("expected list to reject");
        },
        (error: unknown) => error,
      );

      expect(isLangWatchHandledError(thrown)).toBe(true);
      expect(thrown).toMatchObject({
        code: "invalid_api_key",
        httpStatus: 401,
      });
    });
  });

  describe("when the failure body is not the platform's shape", () => {
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
      expect(thrown).toBeInstanceOf(TestSuitesApiError);
      expect((thrown as TestSuitesApiError).status).toBe(502);
    });
  });
});

describe("the LangWatch client, given the two families", () => {
  /** @scenario "The client exposes both services" */
  it("exposes runPlans, testSuites and the deprecated suites", () => {
    const client = new LangWatch({
      apiKey: "test-key",
      endpoint: "http://localhost:5560",
    });

    expect(client.runPlans).toBeInstanceOf(RunPlansApiService);
    expect(client.testSuites).toBeInstanceOf(TestSuitesApiService);
    expect(client.suites).toBeInstanceOf(SuitesApiService);
  });
});
