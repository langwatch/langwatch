/**
 * @vitest-environment node
 * Which of a run's findings keep their query: the analytics module's validation door decides,
 * asked with the protections of the person the run is for.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import type { AnalyticsApi, LangWatchQLProtections } from "@langwatch/analytics-contract";
import { HandledError } from "@langwatch/handled-error";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { CheckedFinding } from "../../rules/insight-daily-run-answer.rules.ts";
import { InsightRunQueryService } from "../insight-run-query.service.ts";

class Refusal extends HandledError {}

const PROTECTIONS: LangWatchQLProtections = { catalogue: { permissions: ["analytics:view"] } };
const WINDOW = { start: Date.UTC(2026, 9, 9), end: Date.UTC(2026, 9, 10) };
const PERSON = { projectId: "project-1", userId: "user-1" };

const finding = (title: string, lwql: string | null): CheckedFinding => ({
  title,
  body: "Cost rose from 41 to 96 dollars.",
  tone: "bad",
  topic: null,
  validDays: 7,
  lwql,
  widget: null,
});

type Analytics = Pick<AnalyticsApi, "resolveProtections" | "validateLangWatchQL">;

function harness(validate: (sql: string) => void = () => undefined) {
  const asked: unknown[] = [];
  const service = InsightRunQueryService.create({
    analytics: createApiFixture<Analytics>({
      resolveProtections: async (input) => {
        asked.push(input);
        return PROTECTIONS;
      },
      validateLangWatchQL: (input) => {
        asked.push(input);
        validate(input.sql);
        return { parameters: [], appFunctions: [] };
      },
    }),
  });
  const keepValid = (findings: readonly CheckedFinding[]) =>
    service.keepValid({ ...PERSON, window: WINDOW, findings });
  return { keepValid, asked };
}

describe("InsightRunQueryService", () => {
  describe("given a query the analytics module refuses and one it admits", () => {
    it("drops the refused query alone, and keeps every finding in its place", async () => {
      const { keepValid, asked } = harness((sql) => {
        if (sql === "from api_keys") throw new Refusal("lwql_not_permitted", "refused");
      });

      const kept = await keepValid([
        finding("refused", "from api_keys"),
        finding("no query", null),
        finding("admitted", "from traces"),
      ]);

      expect(kept).toEqual([
        finding("refused", null),
        finding("no query", null),
        finding("admitted", "from traces"),
      ]);
      const timeWindow = { start: "2026-10-09T00:00:00Z", end: "2026-10-10T00:00:00Z" };
      const validation = { projectId: "project-1", protections: PROTECTIONS, parameters: {} };
      expect(asked).toEqual([
        PERSON,
        { ...validation, sql: "from api_keys", timeWindow },
        { ...validation, sql: "from traces", timeWindow },
      ]);
    });
  });

  describe("given findings that carry no query", () => {
    it("asks the analytics module nothing", async () => {
      const { keepValid, asked } = harness();

      await expect(keepValid([finding("plain", null)])).resolves.toEqual([finding("plain", null)]);
      expect(asked).toEqual([]);
    });
  });

  describe("given the analytics module fails rather than refuses", () => {
    it("throws for the run to retry, and decides nothing about the query", async () => {
      const { keepValid } = harness(() => {
        throw new Error("the catalogue is unreachable");
      });

      await expect(keepValid([finding("unknown", "from traces")])).rejects.toThrow(
        "the catalogue is unreachable",
      );
    });
  });
});
