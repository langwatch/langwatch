import { type Authorization, honouredSpanBraidGrants } from "@langwatch/authorization";
import { fenceFor } from "@langwatch/clickhouse-client";
import { planSchema } from "@langwatch/entitlement-contract";
import type { PlanType } from "@langwatch/plans";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import {
  braidedProof,
  ownProof,
  TEST_PROOF_LIFETIME_MS,
} from "../../__tests__/support/authorization-proofs.fixture.ts";
import { MemoryNullTraceBraidReadsRepository } from "../../features/braid/repositories/memory/memory.null-trace-braid-reads.repository.ts";
import { readsBraidedSpans } from "../../features/braid/rules/braided-span-owner.rules.ts";
import type { TraceAppDependencies } from "../trace.app.ts";
import { createTraceAppHarness } from "./support/trace-app.harness.ts";

const READER = "proj_orchestrator";
const OWNER = "proj_specialists";

const BRAID_ID = "braid_web";

/**
 * The trace detail's proof as the route mints it, with the organisation on the plan named and
 * its "Braids enabled" setting as `settings.braidsEnabled` holds it when asked.
 */
function detailApp({
  planType,
  braidsEnabled = true,
}: {
  planType?: PlanType;
  braidsEnabled?: boolean;
}) {
  const asked: string[] = [];
  const counted: Authorization[] = [];
  const settings = { braidsEnabled, asked: 0 };
  const app = createTraceAppHarness({
    braidSettings: createApiFixture<TraceAppDependencies["braidSettings"]>(
      {
        getOrganizationPolicy: async ({ organizationId }) => {
          settings.asked++;
          return {
            organizationId,
            braidsOrganizationAdminsOnly: false,
            braidsEnabled: settings.braidsEnabled,
            updatedByUserId: null,
            updatedAtMs: null,
          };
        },
      },
      "braidSettings",
    ),
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
    braidDirectory: {
      authz: createApiFixture<NonNullable<TraceAppDependencies["braidDirectory"]>["authz"]>(
        {
          recordBraidedSpansView: async () => undefined,
          assertBraidsReleased: async () => undefined,
          listBraids: async () => ({
            intoOtherProjects: [],
            fromOtherProjects: [
              {
                braidId: BRAID_ID,
                ownerProjectId: OWNER,
                readerProjectId: READER,
                where: 'attributes["orchestrator"] == "web"',
                fromMs: 0,
                expiresAtMs: null,
                createdByUserId: null,
                createdAtMs: 0,
              },
            ],
          }),
        },
        "authz",
      ),
      projects: createApiFixture<NonNullable<TraceAppDependencies["braidDirectory"]>["projects"]>(
        {},
        "projects",
      ),
    },
    traces: {
      summary: createApiFixture<TraceAppDependencies["traces"]["summary"]>(
        { getTraceAuthorization: async ({ authorization }) => authorization },
        "summary",
      ),
      braidReads: Object.assign(MemoryNullTraceBraidReadsRepository.create(), {
        countReaderBraidActivity: async ({ authorization }: { authorization: Authorization }) => {
          counted.push(authorization);
          return new Map([[BRAID_ID, honouredSpanBraidGrants(authorization).length > 0 ? 3 : 0]]);
        },
      }),
    },
  });
  const open = (authorization: Authorization) =>
    app.authorizationForTrace({ authorization, traceId: "trace-1" });
  const countActivity = () =>
    app.readBraidActivity({ projectId: READER, authorization: braided(), braidIds: [BRAID_ID] });
  return { open, countActivity, counted, asked, settings };
}

/** The route's proof: braids carried, not yet honoured by the plan check. */
const braided = () =>
  braidedProof({ projectId: READER, braids: [{ owner: OWNER }], honoured: false });
const spanFenceOf = (authorization: Authorization) => fenceFor({ authorization, reads: "spans" });

describe("braided spans and the organisation's plan", () => {
  describe("given an organisation below Enterprise", () => {
    /** @scenario After leaving Enterprise, braids stop showing and are kept */
    it("reads the trace without its braids, keeping the own grant", async () => {
      const { open } = detailApp({ planType: "LAUNCH" });

      const proof = await open(braided());

      expect(readsBraidedSpans(proof)).toBe(false);
      expect(proof.grants.map((grant) => grant.projectId)).toEqual([READER]);
      expect(spanFenceOf(proof).braids).toBeUndefined();
    });

    /** @scenario A paused braid counts no braided spans on the reader's Braids page */
    it("counts the reader's Braids page activity without the braids", async () => {
      const { countActivity, counted } = detailApp({ planType: "LAUNCH" });

      const { activity } = await countActivity();

      expect(counted.map(readsBraidedSpans)).toEqual([false]);
      expect(activity).toEqual([{ braidId: BRAID_ID, spanCount: 0 }]);
    });
  });

  describe("given an Enterprise organisation", () => {
    /** @scenario "A proof the plan check honoured shows the braided spans" */
    it("honours the braids, so the span fence reads the owner", async () => {
      const { open } = detailApp({ planType: "ENTERPRISE" });

      const proof = await open(braided());

      expect(proof.braidsHonoured).toBe(true);
      expect(spanFenceOf(proof).braids?.clauses).toHaveLength(1);
      expect(spanFenceOf(braided()).braids).toBeUndefined();
    });

    it("counts the reader's Braids page activity through the braids", async () => {
      const { countActivity } = detailApp({ planType: "ENTERPRISE" });

      expect((await countActivity()).activity).toEqual([{ braidId: BRAID_ID, spanCount: 3 }]);
    });

    it("asks the plan once per organisation while the proof lives", async () => {
      const { open, asked } = detailApp({ planType: "ENTERPRISE" });

      await open(braided());
      await open(braided());

      expect(asked).toEqual(["test-organization"]);
    });
  });

  describe("given an Enterprise organisation with Braids turned off in settings", () => {
    /** @scenario Turning Braids off pauses braids within thirty seconds and keeps them */
    it("asks the setting again once the proof that cached the answer has expired", async () => {
      const { open, settings } = detailApp({ planType: "ENTERPRISE" });
      // The answer lives no longer than the asking proof, itself within the 30 s proof bound.
      const shortLived = braidedProof({
        projectId: READER,
        braids: [{ owner: OWNER }],
        honoured: false,
        now: Date.now() - TEST_PROOF_LIFETIME_MS + 5,
      });
      expect(readsBraidedSpans(await open(shortLived))).toBe(true);

      settings.braidsEnabled = false;
      await new Promise((resolve) => setTimeout(resolve, 20));
      const proof = await open(braided());

      expect(readsBraidedSpans(proof)).toBe(false);
      expect(spanFenceOf(proof).braids).toBeUndefined();
      expect(settings.asked).toBe(2);
    });

    it("strips the braids for a proof minted after the setting was turned off", async () => {
      const { open } = detailApp({ planType: "ENTERPRISE", braidsEnabled: false });

      const proof = await open(braided());

      expect(readsBraidedSpans(proof)).toBe(false);
      expect(proof.grants.map((grant) => grant.projectId)).toEqual([READER]);
      expect(spanFenceOf(proof).braids).toBeUndefined();
    });

    /** @scenario Turning Braids on again resumes the braids it paused */
    it("honours the same braid again for a proof minted after Braids is turned back on", async () => {
      const paused = detailApp({ planType: "ENTERPRISE", braidsEnabled: false });
      const resumed = detailApp({ planType: "ENTERPRISE", braidsEnabled: true });

      expect(readsBraidedSpans(await paused.open(braided()))).toBe(false);
      expect(spanFenceOf(await resumed.open(braided())).braids?.clauses).toHaveLength(1);
    });
  });

  describe("given an organisation below Enterprise with Braids turned on", () => {
    it("never asks the setting and honours no braid", async () => {
      const { open, settings } = detailApp({ planType: "LAUNCH" });

      expect(readsBraidedSpans(await open(braided()))).toBe(false);
      expect(settings.asked).toBe(0);
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

  describe("given an organisation on the free plan", () => {
    it("honours no braid", async () => {
      const { open } = detailApp({});

      const proof = await open(braided());

      expect(readsBraidedSpans(proof)).toBe(false);
      expect(spanFenceOf(proof).braids).toBeUndefined();
    });
  });
});
