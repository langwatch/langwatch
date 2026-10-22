/**
 * `LangWatchQLBoundsService`: a background caller shares the project's one window but may use
 * only a third of its bound; a person keeps the whole bound.
 * @vitest-environment node
 */
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { AnalyticsRateLimitRepository } from "../../repositories/analytics-rate-limit.repository.ts";
import { MemoryAnalyticsRateLimitRepository } from "../../repositories/memory/memory.analytics-rate-limit.repository.ts";
import { LangWatchQLBoundsService } from "../langwatch-ql-bounds.service.ts";

const BOUND = 30;
const BACKGROUND_SHARE = 10;

function boundsAt({ bound }: { bound: number }) {
  const scopes: (string | undefined)[] = [];
  const memory = MemoryAnalyticsRateLimitRepository.create();
  const rateLimits: AnalyticsRateLimitRepository = {
    check: (key, limit) => {
      scopes.push(limit.scope);
      return memory.check(key, limit);
    },
  };
  const bounds = LangWatchQLBoundsService.create({
    entitlement: createApiFixture<EntitlementApi>({
      requestBound: () => Promise.resolve(bound),
    }),
    projects: createApiFixture<ProjectApi>({
      getOrganizationId: () => Promise.resolve("org-1"),
    }),
    rateLimits,
  });

  const outcome = (admission: Promise<void>) =>
    admission.then(
      () => "admitted",
      (error: unknown) =>
        error instanceof Error && "code" in error ? String(error.code) : "unknown",
    );
  const run = () => outcome(bounds.assertQueryWithinBounds({ projectId: "project-1" }));
  const runBackground = () =>
    outcome(bounds.assertBackgroundQueryWithinBounds({ projectId: "project-1" }));

  const admitTimes = async ({ times, admit }: { times: number; admit: () => Promise<string> }) => {
    for (let index = 0; index < times; index++) {
      expect(await admit()).toBe("admitted");
    }
  };

  return { run, runBackground, admitTimes, scopes };
}

describe("LangWatchQLBoundsService", () => {
  describe("given background executions in one window", () => {
    /** @scenario "A background execution is refused once the window holds a third of the bound" */
    it("admits a third of the bound, then refuses as rate limited", async () => {
      const { runBackground, admitTimes } = boundsAt({ bound: BOUND });

      await admitTimes({ times: BACKGROUND_SHARE, admit: runBackground });

      expect(await runBackground()).toBe("lwql_rate_limited");
    });

    /** @scenario "A background execution is refused once the window holds a third of the bound" */
    it("counts a person's executions toward the background third", async () => {
      const { run, runBackground, admitTimes } = boundsAt({ bound: BOUND });

      await admitTimes({ times: BACKGROUND_SHARE, admit: run });

      expect(await runBackground()).toBe("lwql_rate_limited");
    });

    it("admits one background execution when a third of the bound rounds to none", async () => {
      const { runBackground } = boundsAt({ bound: 2 });

      expect(await runBackground()).toBe("admitted");
      expect(await runBackground()).toBe("lwql_rate_limited");
    });
  });

  describe("given a background and a foreground execution", () => {
    /** @scenario "A refused background execution is counted apart from people's" */
    it("labels only the background check with its own scope", async () => {
      const { run, runBackground, scopes } = boundsAt({ bound: BOUND });

      await runBackground();
      await run();

      expect(scopes).toEqual(["lwql_background", undefined]);
    });
  });

  describe("given a window that holds a third of the bound from background executions", () => {
    /** @scenario "A foreground execution still has the whole window" */
    it("admits a person up to the full bound", async () => {
      const { run, runBackground, admitTimes } = boundsAt({ bound: BOUND });
      await admitTimes({ times: BACKGROUND_SHARE, admit: runBackground });

      await admitTimes({ times: BOUND - BACKGROUND_SHARE, admit: run });

      expect(await run()).toBe("lwql_rate_limited");
    });
  });
});
