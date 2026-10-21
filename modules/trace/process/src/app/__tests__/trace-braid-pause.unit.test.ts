import type { Authorization } from "@langwatch/authorization";
import { planSchema } from "@langwatch/entitlement-contract";
import type { PlanType } from "@langwatch/plans";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { braidedProof, ownProof } from "../../__tests__/support/authorization-proofs.fixture.ts";
import { readsBraidedSpans } from "../../rules/braided-span-owner.rules.ts";
import type { TraceAppDependencies } from "../trace.app.ts";
import { createTraceAppHarness } from "./support/trace-app.harness.ts";

const READER = "proj_orchestrator";
const OWNER = "proj_specialists";

/** The trace detail's proof as the route mints it, with the organisation on the plan named. */
function detailApp({ planType }: { planType?: PlanType }) {
  const asked: string[] = [];
  const app = createTraceAppHarness({
    ...(planType === undefined
      ? {}
      : {
          braidPlans: createApiFixture<NonNullable<TraceAppDependencies["braidPlans"]>>(
            {
              getActivePlan: async ({ organizationId }) => {
                asked.push(organizationId);
                return planSchema.parse({
                  planSource: "subscription",
                  type: planType,
                  name: planType,
                  free: false,
                  maxMessagesPerMonth: 0,
                  maxMembers: 0,
                  maxMembersLite: 0,
                  canPublish: true,
                  prices: { USD: 0, EUR: 0 },
                });
              },
            },
            "braidPlans",
          ),
        }),
    traces: {
      summary: createApiFixture<TraceAppDependencies["traces"]["summary"]>(
        { getTraceAuthorization: async ({ authorization }) => authorization },
        "summary",
      ),
    },
  });
  const open = (authorization: Authorization) =>
    app.authorizationForTrace({ authorization, traceId: "trace-1" });
  return { open, asked };
}

const braided = () => braidedProof({ projectId: READER, braids: [{ owner: OWNER }] });

describe("braided spans and the organisation's plan", () => {
  describe("given an organisation below Enterprise", () => {
    /** @scenario After leaving Enterprise, braids stop showing and are kept */
    it("reads the trace without its braids, keeping the own grant", async () => {
      const { open } = detailApp({ planType: "LAUNCH" });

      const proof = await open(braided());

      expect(readsBraidedSpans(proof)).toBe(false);
      expect(proof.grants.map((grant) => grant.projectId)).toEqual([READER]);
    });
  });

  describe("given an Enterprise organisation", () => {
    it("honours the braids", async () => {
      const { open } = detailApp({ planType: "ENTERPRISE" });

      expect(readsBraidedSpans(await open(braided()))).toBe(true);
    });

    it("asks the plan once per organisation while the proof lives", async () => {
      const { open, asked } = detailApp({ planType: "ENTERPRISE" });

      await open(braided());
      await open(braided());

      expect(asked).toEqual(["test-organization"]);
    });
  });

  describe("given a proof carrying no braid", () => {
    it("never asks the plan and returns the proof as it is", async () => {
      const { open, asked } = detailApp({ planType: "LAUNCH" });
      const own = ownProof({ projectId: READER });

      expect(await open(own)).toBe(own);
      expect(asked).toHaveLength(0);
    });
  });

  describe("given a process composed without plans", () => {
    it("honours no braid", async () => {
      const { open } = detailApp({});

      expect(readsBraidedSpans(await open(braided()))).toBe(false);
    });
  });
});
