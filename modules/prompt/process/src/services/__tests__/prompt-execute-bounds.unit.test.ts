import { createApiFixture } from "@langwatch/api-fixture";
/**
 * `PromptExecuteBoundsService` — the playground door's per-project run window
 * and message cap, resolved per caller tier through the entitlement peer.
 * @vitest-environment node
 */
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { resolveRequestBound, type RequestBoundKey } from "@langwatch/plans";
import type { RateLimiter } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import { PromptExecuteBoundsService } from "../prompt-execute-bounds.service.ts";

const FREE_TIER_ORG = "org-free";
const ENTERPRISE_TIER_ORG = "org-enterprise";

const TIER_PLAN_TYPE: Record<string, string> = {
  [FREE_TIER_ORG]: "FREE",
  [ENTERPRISE_TIER_ORG]: "ENTERPRISE",
};

/** The plan each organization answers, resolved exactly as the entitlement peer resolves it. */
function tieredEntitlement(calls: RequestBoundKey[]): EntitlementApi {
  return createApiFixture<EntitlementApi>({
    requestBound: ({ key, organizationId }) => {
      calls.push(key);
      return Promise.resolve(resolveRequestBound(key, TIER_PLAN_TYPE[organizationId] ?? "FREE"));
    },
  });
}

/** A real fixed window: each key counts its own checks, refused past the allowance named. */
function windowLimiter() {
  const used = new Map<string, number>();
  const limiter: RateLimiter = {
    check: (key, limit) => {
      const count = (used.get(key) ?? 0) + 1;
      used.set(key, count);
      const requests = limit?.requests ?? Number.POSITIVE_INFINITY;

      return Promise.resolve(
        count <= requests ? { allowed: true } : { allowed: false, retryAfterSeconds: 60 },
      );
    },
  };

  return limiter;
}

function harness() {
  const boundKeysAsked: RequestBoundKey[] = [];
  const service = PromptExecuteBoundsService.create({
    entitlement: tieredEntitlement(boundKeysAsked),
    projects: createApiFixture<ProjectApi>({
      getOrganizationId: (projectId) =>
        Promise.resolve(projectId === "project-enterprise" ? ENTERPRISE_TIER_ORG : FREE_TIER_ORG),
    }),
    rateLimiter: windowLimiter(),
  });

  const run = (projectId: string, messageCount = 1) =>
    service.assertExecuteWithinBounds({ projectId, messageCount });

  return { run, boundKeysAsked };
}

const FREE_RUNS_PER_MINUTE = resolveRequestBound("promptExecutePerMinute", "FREE");
const FREE_MESSAGES_MAX = resolveRequestBound("promptMessagesMax", "FREE");

describe("PromptExecuteBoundsService", () => {
  describe("given a free-tier project under its run ceiling", () => {
    it("lets every run through", async () => {
      const { run } = harness();

      for (let index = 0; index < FREE_RUNS_PER_MINUTE; index++) {
        await expect(run("project-free")).resolves.toBeUndefined();
      }
    });
  });

  describe("given a free-tier project at its run ceiling", () => {
    it("refuses the next run 429 and never asks the message bound", async () => {
      const { run, boundKeysAsked } = harness();
      for (let index = 0; index < FREE_RUNS_PER_MINUTE; index++) {
        await run("project-free");
      }
      boundKeysAsked.length = 0;

      const refusal = await run("project-free").catch((error: unknown) => error);

      expect(refusal).toMatchObject({
        code: "prompt_execute_rate_limited",
        httpStatus: 429,
        retryable: true,
        fault: "customer",
        meta: { retryAfterSeconds: 60 },
      });
      // The window answered before the message bound was ever asked: the run
      // was refused at the counter, before any further work, LLM calls
      // included.
      expect(boundKeysAsked).toEqual(["promptExecutePerMinute"]);
    });
  });

  describe("given an enterprise project past the free run ceiling", () => {
    it("lets the run through: the ceiling is tier-resolved, not static", async () => {
      const { run } = harness();
      for (let index = 0; index < FREE_RUNS_PER_MINUTE; index++) {
        await run("project-enterprise");
      }

      await expect(run("project-enterprise")).resolves.toBeUndefined();
    });
  });

  describe("given a free-tier project within its run window", () => {
    it("refuses a message array over the free bound, while the enterprise ceiling still passes", async () => {
      const { run } = harness();

      const refusal = await run("project-free", FREE_MESSAGES_MAX + 1).catch(
        (error: unknown) => error,
      );

      expect(refusal).toMatchObject({
        code: "prompt_messages_too_many",
        httpStatus: 422,
        fault: "customer",
        meta: { maxMessages: FREE_MESSAGES_MAX },
      });
      await expect(run("project-enterprise", FREE_MESSAGES_MAX + 1)).resolves.toBeUndefined();
    });
  });
});
