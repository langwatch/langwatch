/**
 * Instant Evals own whether a statement may call an eval function: every pass the row source
 * sends carries the access service's answer, which Analytics takes as given.
 * @see modules/instant-eval/specs/instant-eval-opt-in.feature
 */

import type { LangWatchQLPassInput, LangWatchQLQueryResult } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { InstantEvalAccessService } from "../instant-eval-access.service.ts";
import { InstantEvalRowSourceService } from "../instant-eval-row-source.service.ts";

const CALLER = { id: "project-1", lwqlKey: "lwql-secret" };
const PROTECTIONS = { catalogue: { permissions: [] } };
const SQL = "SELECT TraceId, eval(TraceName, 'is it rude?') AS rude FROM analytics.traces";

/** What the run's statement is read under: the deployment and the organization's answers. */
function passFor({
  flag,
  judgesThroughConnect,
  isLicensed,
  isOptedIn,
  hosted = false,
}: {
  flag: boolean;
  judgesThroughConnect: boolean;
  isLicensed: boolean;
  isOptedIn: boolean;
  hosted?: boolean;
}) {
  const asked: LangWatchQLPassInput[] = [];
  const access = InstantEvalAccessService.create({
    flags: { isEnabled: () => Promise.resolve(flag) },
    projects: { findOrganizationId: () => Promise.resolve("organization-1") },
    judgesThroughConnect,
    optIns: { isOptedIn: () => Promise.resolve(isOptedIn) },
    isJudgeConfigured: () => true,
    hostedPlans: hosted ? { isEnterprisePlan: () => Promise.resolve(false) } : null,
    ...(judgesThroughConnect
      ? { judge: { isAvailableForOrganization: () => Promise.resolve(isLicensed) } }
      : {}),
  });
  const source = InstantEvalRowSourceService.create({
    analytics: {
      executeLangWatchQLPass: (input): Promise<LangWatchQLQueryResult> => {
        asked.push(input);
        return Promise.resolve({
          columns: [{ name: "TraceId", type: "String" }],
          rows: [],
          statistics: { elapsedMs: 1, rowsRead: 0, bytesRead: 0, rowsReturned: 0 },
          diagnostics: [],
          followsTimeWindow: true,
          followsGranularity: true,
        });
      },
    },
    access,
  });

  return async () => {
    await source.probe({ caller: CALLER, protections: PROTECTIONS, sql: SQL });
    return asked.map((input) => input.isInstantEvalsEnabled);
  };
}

describe("given a run reading a statement that calls an eval function", () => {
  describe("when a connected install's license does not name Instant Evals", () => {
    /** @scenario "Every read a run makes carries Instant Evals' own answer to whether eval functions may run" */
    it("states that eval functions are refused", async () => {
      const read = passFor({
        flag: false,
        judgesThroughConnect: true,
        isLicensed: false,
        isOptedIn: false,
      });

      await expect(read()).resolves.toEqual([false]);
    });
  });

  describe("when a connected install is licensed and its organization opted in", () => {
    /** @scenario "Every read a run makes carries Instant Evals' own answer to whether eval functions may run" */
    it("states that eval functions are allowed without the flag", async () => {
      const read = passFor({
        flag: false,
        judgesThroughConnect: true,
        isLicensed: true,
        isOptedIn: true,
      });

      await expect(read()).resolves.toEqual([true]);
    });
  });

  describe("when an organization on the hosted service switched Instant Evals on", () => {
    /** @scenario "Every read a run makes carries Instant Evals' own answer to whether eval functions may run" */
    it("states that eval functions are allowed without the flag", async () => {
      const read = passFor({
        flag: false,
        judgesThroughConnect: false,
        isLicensed: false,
        isOptedIn: true,
        hosted: true,
      });

      await expect(read()).resolves.toEqual([true]);
    });
  });

  describe("when the flag is off and nothing else releases the project", () => {
    /** @scenario "Every read a run makes carries Instant Evals' own answer to whether eval functions may run" */
    it("states that eval functions are refused", async () => {
      const read = passFor({
        flag: false,
        judgesThroughConnect: false,
        isLicensed: false,
        isOptedIn: false,
      });

      await expect(read()).resolves.toEqual([false]);
    });
  });
});
