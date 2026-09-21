/**
 * The scenarios service: the field values a scenario carries for the fields
 * its test suite declares travel under `fields`, and an empty map clears them.
 *
 * Spec: specs/typescript-sdk/run-plans-and-test-suites.feature
 */
import { describe, expect, it, vi } from "vitest";
import type { LangwatchApiClient } from "@/internal/api/client";
import { ScenariosApiService } from "../scenarios-api.service";

const serviceWith = (result: { data?: unknown; error?: unknown }) => {
  const calls = {
    GET: vi.fn(async () => result),
    POST: vi.fn(async (_path: string, _init?: unknown) => result),
    PUT: vi.fn(async (_path: string, _init?: unknown) => result),
    DELETE: vi.fn(async () => result),
  };
  return {
    service: new ScenariosApiService({
      langwatchApiClient: calls as unknown as LangwatchApiClient,
    }),
    calls,
  };
};

describe("ScenariosApiService", () => {
  describe("when creating a scenario with field values", () => {
    /** @scenario "Create a scenario with field values" */
    it("posts the values under fields", async () => {
      const { service, calls } = serviceWith({ data: { id: "scenario_1" } });

      await service.create({
        name: "Chargebacks by quarter",
        situation: "A fraud analyst asks for chargebacks per quarter.",
        criteria: ["Answers with one row per quarter"],
        testSuiteId: "suite_abc",
        fields: { golden_sql: "SELECT 1", row_limit: 10, strict: true },
      });

      expect(calls.POST).toHaveBeenCalledWith("/api/scenarios", {
        body: {
          name: "Chargebacks by quarter",
          situation: "A fraud analyst asks for chargebacks per quarter.",
          criteria: ["Answers with one row per quarter"],
          testSuiteId: "suite_abc",
          fields: { golden_sql: "SELECT 1", row_limit: 10, strict: true },
        },
      });
    });
  });

  describe("when updating a scenario with an empty field map", () => {
    /** @scenario "Update a scenario with an empty field map" */
    it("sends fields as an empty object", async () => {
      const { service, calls } = serviceWith({ data: { id: "scenario_1" } });

      await service.update("scenario_1", { fields: {} });

      expect(calls.PUT).toHaveBeenCalledWith("/api/scenarios/{id}", {
        params: { path: { id: "scenario_1" } },
        body: { fields: {} },
      });
    });
  });
});
