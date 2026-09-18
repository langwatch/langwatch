/**
 * `ScenarioGenerateBoundsService` — the author-assist's per-project
 * generation window, resolved per caller tier through the entitlement peer.
 * @vitest-environment node
 */
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { RateLimiter } from "@langwatch/process-stores/members";
import { resolveRequestBound } from "@langwatch/plans";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import { ScenarioGenerateBoundsService } from "../scenario-generate-bounds.service.ts";

const TIER_PLAN_TYPE: Record<string, string> = {
  "org-free": "FREE",
  "org-enterprise": "ENTERPRISE",
};

/** The plan each organization answers, resolved exactly as the entitlement peer resolves it. */
const tieredEntitlement: Pick<EntitlementApi, "requestBound"> = {
  requestBound: ({ key, organizationId }) =>
    Promise.resolve(resolveRequestBound(key, TIER_PLAN_TYPE[organizationId] ?? "FREE")),
};

/** A real fixed window: each key counts its own checks, refused past the allowance named. */
function windowLimiter(): RateLimiter {
  const used = new Map<string, number>();
  return {
    check: (key, limit) => {
      const count = (used.get(key) ?? 0) + 1;
      used.set(key, count);
      const requests = limit?.requests ?? Number.POSITIVE_INFINITY;

      return Promise.resolve(
        count <= requests ? { allowed: true } : { allowed: false, retryAfterSeconds: 60 },
      );
    },
  };
}

function harness() {
  const service = ScenarioGenerateBoundsService.create({
    entitlement: tieredEntitlement,
    projects: {
      getOrganizationId: (projectId) =>
        Promise.resolve(projectId === "project-enterprise" ? "org-enterprise" : "org-free"),
    } as Pick<ProjectApi, "getOrganizationId">,
    rateLimiter: windowLimiter(),
  });

  return { generate: (projectId: string) => service.assertGenerateWithinBounds({ projectId }) };
}

const FREE_GENERATIONS_PER_MINUTE = resolveRequestBound("scenarioGeneratePerMinute", "FREE");

describe("ScenarioGenerateBoundsService", () => {
  describe("given a free-tier project under its generation ceiling", () => {
    it("lets every generation through", async () => {
      const { generate } = harness();

      for (let index = 0; index < FREE_GENERATIONS_PER_MINUTE; index++) {
        await expect(generate("project-free")).resolves.toBeUndefined();
      }
    });
  });

  describe("given a free-tier project at its generation ceiling", () => {
    it("refuses the next generation 429", async () => {
      const { generate } = harness();
      for (let index = 0; index < FREE_GENERATIONS_PER_MINUTE; index++) {
        await generate("project-free");
      }

      const refusal = await generate("project-free").catch((error: unknown) => error);

      expect(refusal).toMatchObject({
        code: "scenario_generate_rate_limited",
        httpStatus: 429,
        retryable: true,
        fault: "customer",
        meta: { retryAfterSeconds: 60 },
      });
    });
  });

  describe("given an enterprise project past the free generation ceiling", () => {
    it("lets the generation through: the ceiling is tier-resolved, not static", async () => {
      const { generate } = harness();
      for (let index = 0; index < FREE_GENERATIONS_PER_MINUTE; index++) {
        await generate("project-enterprise");
      }

      await expect(generate("project-enterprise")).resolves.toBeUndefined();
    });
  });
});
