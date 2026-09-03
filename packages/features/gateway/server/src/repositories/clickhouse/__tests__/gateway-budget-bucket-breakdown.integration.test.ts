/**
 * @vitest-environment node
 *
 * Per-bucket spend for a fanned-out budget, against real ClickHouse.
 *
 * An ATTRIBUTED_USER template is one row covering many people, so the only
 * honest thing the budgets screen can say about it is a headcount. That
 * headcount is only as good as the bucket set this read returns, and the
 * ways it can be wrong are all silent: swallowing a neighbouring anchor's
 * buckets inflates it, missing the boundary a reset moved leaves a
 * forgiven person still counted as over, and a provider filter that leaks
 * makes two budgets report each other's people.
 *
 * Debits go in through the same repository the debits process manager
 * writes with, and come back out through the same method the budgets list,
 * the detail page, and the management API all read.
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  GatewayBudget,
  GatewayBudgetWindow,
} from "@langwatch/prisma-client/generated";
import { Prisma } from "@langwatch/prisma-client/generated";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "./support/clickhouse-endpoint.support";
import {
  type BucketSpend,
  GatewayBudgetClickHouseRepository,
} from "../clickhouse.gateway-budget.repository";
import { PROVIDER_BUCKET_SEPARATOR } from "../../../adapters/gateway-bucket-scope.adapter";

const chUrl = testClickHouseUrl();

const suffix = nanoid(8);
const ORG_ID = `org-breakdown-${suffix}`;
const TEAM_ID = `team-breakdown-${suffix}`;
const TENANT_ID = `proj-breakdown-${suffix}`;
const PROVIDER_KEY = `prov-openai-${suffix}`;

const LIMIT_USD = "1.00";

/** The instant every debit is written at and every read is anchored to. */
const NOW = new Date();

function templateFor(args: {
  id: string;
  anchorId: string;
  window?: GatewayBudgetWindow;
  providerKey?: string | null;
  currentPeriodStartedAt?: Date;
}): GatewayBudget {
  return {
    id: args.id,
    organizationId: ORG_ID,
    scopeType: "ATTRIBUTED_USER",
    scopeId: args.anchorId,
    name: args.id,
    description: null,
    window: args.window ?? "DAY",
    limitUsd: new Prisma.Decimal(LIMIT_USD),
    onBreach: "BLOCK",
    timezone: null,
    spentUsd: new Prisma.Decimal("0"),
    currentPeriodStartedAt: args.currentPeriodStartedAt ?? NOW,
    resetsAt: new Date(NOW.getTime() + 86_400_000),
    lastResetAt: null,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    createdById: `usr-${suffix}`,
    providerKey: args.providerKey ?? null,
  } as GatewayBudget;
}

let repo: GatewayBudgetClickHouseRepository;

/**
 * One request's worth of ledger rows. `bucketScopeId` is written verbatim so
 * a fixture can plant the historical bare-anchor shape the prefix predicate
 * has to exclude.
 */
async function debit(args: {
  budgetId: string;
  bucketScopeId: string;
  amountNanoUsd: number;
  window?: GatewayBudgetWindow;
  status?: "SUCCESS" | "PROVIDER_ERROR";
  tokensInput?: number;
  occurredAt?: Date;
}): Promise<void> {
  await repo.insertDebit([
    {
      tenantId: TENANT_ID,
      budgetId: args.budgetId,
      scope: "ATTRIBUTED_USER",
      scopeId: args.bucketScopeId,
      window: args.window ?? "DAY",
      virtualKeyId: `vk_${suffix}`,
      gatewayRequestId: `grq_${nanoid()}`,
      amountNanoUsd: args.amountNanoUsd,
      tokensInput: args.tokensInput ?? 100,
      tokensOutput: 50,
      tokensCacheRead: 0,
      tokensCacheWrite: 0,
      model: "gpt-5-mini",
      durationMs: 100,
      status: args.status ?? "SUCCESS",
      occurredAt: args.occurredAt ?? NOW,
    },
  ]);
}

/** The over-cap count the display derives, with the gateway's comparator. */
function overCap(buckets: BucketSpend[], limitUsd = Number(LIMIT_USD)): number {
  return buckets.filter((b) => Number.parseFloat(b.spentUsd) >= limitUsd)
    .length;
}

describe.skipIf(!chUrl)(
  "given per-user buckets recorded against attributed-user templates",
  () => {
    beforeAll(async () => {
      repo = new GatewayBudgetClickHouseRepository(async () =>
        createTestClickHouseClient(chUrl!),
      );
    }, 120_000);

    describe("when ten people have spent and three have reached the cap", () => {
      const anchorId = `vkanchor-headcount-${suffix}`;
      const template = templateFor({
        id: `bdg-headcount-${suffix}`,
        anchorId,
      });
      let buckets: BucketSpend[];

      beforeAll(async () => {
        for (let i = 1; i <= 10; i++) {
          await debit({
            budgetId: template.id,
            bucketScopeId: `${anchorId}:user${i}`,
            // The first three land exactly on the limit, which is the seam
            // the gateway's `>=` comparator sits on.
            amountNanoUsd: i <= 3 ? 1_000_000_000 : 100_000_000,
          });
        }
        buckets = await repo.getBucketSpendBreakdownForBudget({
          budget: template,
          tenantIds: [TENANT_ID],
          boundaries: [],
          now: NOW,
        });
      }, 120_000);

      /** @scenario "A per-person template counts the people it has seen and the people over cap" */
      it("returns one entry per end user who spent", () => {
        expect(buckets).toHaveLength(10);
        expect(buckets.map((b) => b.scopeId).sort()).toEqual(
          Array.from({ length: 10 }, (_, i) => `${anchorId}:user${i + 1}`).sort(),
        );
      });

      /** @scenario "A per-person template counts the people it has seen and the people over cap" */
      it("counts a person exactly at the limit as over, matching the gateway", () => {
        expect(overCap(buckets)).toBe(3);
      });
    });

    describe("when one person's usage was unpriced and another's requests only ever failed", () => {
      const anchorId = `vkanchor-edges-${suffix}`;
      const template = templateFor({ id: `bdg-edges-${suffix}`, anchorId });
      let buckets: BucketSpend[];

      beforeAll(async () => {
        // Real usage the catalog had no price for: $0 with tokens, and the
        // ledger row the debits process writes anyway.
        await debit({
          budgetId: template.id,
          bucketScopeId: `${anchorId}:unpriced`,
          amountNanoUsd: 0,
          tokensInput: 900,
        });
        await debit({
          budgetId: template.id,
          bucketScopeId: `${anchorId}:onlyfailed`,
          amountNanoUsd: 500_000_000,
          status: "PROVIDER_ERROR",
        });
        buckets = await repo.getBucketSpendBreakdownForBudget({
          budget: template,
          tenantIds: [TENANT_ID],
          boundaries: [],
          now: NOW,
        });
      }, 120_000);

      /** @scenario "A per-person template counts an unpriced user but not a user who only ever failed" */
      it("counts the unpriced end user as seen, spending nothing", () => {
        expect(buckets).toHaveLength(1);
        expect(buckets[0]!.scopeId).toBe(`${anchorId}:unpriced`);
        expect(Number.parseFloat(buckets[0]!.spentUsd)).toBe(0);
      });

      /** @scenario "A per-person template counts an unpriced user but not a user who only ever failed" */
      it("leaves out the end user whose every request failed", () => {
        expect(buckets.map((b) => b.scopeId)).not.toContain(
          `${anchorId}:onlyfailed`,
        );
        expect(overCap(buckets)).toBe(0);
      });
    });

    describe("when a bare-anchor row and a prefix-colliding anchor sit beside the buckets", () => {
      const anchorId = `vkanchor-collide-${suffix}`;
      // An anchor whose id merely starts with this one's. Without the
      // trailing colon on the prefix its buckets would be counted here.
      const neighbourAnchorId = `${anchorId}x`;
      const template = templateFor({ id: `bdg-collide-${suffix}`, anchorId });
      let buckets: BucketSpend[];

      beforeAll(async () => {
        await debit({
          budgetId: template.id,
          bucketScopeId: `${anchorId}:user1`,
          amountNanoUsd: 2_000_000_000,
        });
        // Historical shape: spend filed against the bare anchor, no end user.
        await debit({
          budgetId: template.id,
          bucketScopeId: anchorId,
          amountNanoUsd: 5_000_000_000,
        });
        await debit({
          budgetId: `bdg-neighbour-${suffix}`,
          bucketScopeId: `${neighbourAnchorId}:user1`,
          amountNanoUsd: 7_000_000_000,
        });
        buckets = await repo.getBucketSpendBreakdownForBudget({
          budget: template,
          tenantIds: [TENANT_ID],
          boundaries: [],
          now: NOW,
        });
      }, 120_000);

      /** @scenario "A per-person template only counts buckets under its own anchor" */
      it("counts only the buckets under its own anchor", () => {
        expect(buckets).toHaveLength(1);
        expect(buckets[0]!.scopeId).toBe(`${anchorId}:user1`);
        expect(Number.parseFloat(buckets[0]!.spentUsd)).toBe(2);
      });

      /** @scenario "A per-person template only counts buckets under its own anchor" */
      it("excludes the bare-anchor row and the neighbouring anchor's buckets", () => {
        const ids = buckets.map((b) => b.scopeId);
        expect(ids).not.toContain(anchorId);
        expect(ids).not.toContain(`${neighbourAnchorId}:user1`);
      });
    });

    describe("when a provider-filtered template shares an anchor with an unfiltered one", () => {
      const anchorId = `vkanchor-provider-${suffix}`;
      const unfiltered = templateFor({
        id: `bdg-unfiltered-${suffix}`,
        anchorId,
      });
      const filtered = templateFor({
        id: `bdg-filtered-${suffix}`,
        anchorId,
        providerKey: PROVIDER_KEY,
      });
      let unfilteredBuckets: BucketSpend[];
      let filteredBuckets: BucketSpend[];

      beforeAll(async () => {
        await debit({
          budgetId: unfiltered.id,
          bucketScopeId: `${anchorId}:plainuser`,
          amountNanoUsd: 2_000_000_000,
        });
        await debit({
          budgetId: filtered.id,
          bucketScopeId: `${anchorId}:pinneduser${PROVIDER_BUCKET_SEPARATOR}${PROVIDER_KEY}`,
          amountNanoUsd: 3_000_000_000,
        });
        unfilteredBuckets = await repo.getBucketSpendBreakdownForBudget({
          budget: unfiltered,
          tenantIds: [TENANT_ID],
          boundaries: [],
          now: NOW,
        });
        filteredBuckets = await repo.getBucketSpendBreakdownForBudget({
          budget: filtered,
          tenantIds: [TENANT_ID],
          boundaries: [],
          now: NOW,
        });
      }, 120_000);

      /** @scenario "A provider-filtered template and its unfiltered twin never count each other's people" */
      it("counts only unsuffixed buckets for the unfiltered template", () => {
        expect(unfilteredBuckets.map((b) => b.scopeId)).toEqual([
          `${anchorId}:plainuser`,
        ]);
        expect(overCap(unfilteredBuckets)).toBe(1);
      });

      /** @scenario "A provider-filtered template and its unfiltered twin never count each other's people" */
      it("counts only its own provider's buckets for the filtered template", () => {
        expect(filteredBuckets.map((b) => b.scopeId)).toEqual([
          `${anchorId}:pinneduser${PROVIDER_BUCKET_SEPARATOR}${PROVIDER_KEY}`,
        ]);
        expect(overCap(filteredBuckets)).toBe(1);
      });
    });

    describe("when one end user's own period boundary has moved past their spend", () => {
      const anchorId = `vkanchor-reset-${suffix}`;
      const template = templateFor({ id: `bdg-reset-${suffix}`, anchorId });
      let buckets: BucketSpend[];

      beforeAll(async () => {
        for (const user of ["resetuser", "untouched"]) {
          await debit({
            budgetId: template.id,
            bucketScopeId: `${anchorId}:${user}`,
            amountNanoUsd: 2_000_000_000,
            occurredAt: new Date(NOW.getTime() - 60_000),
          });
        }
        buckets = await repo.getBucketSpendBreakdownForBudget({
          budget: template,
          tenantIds: [TENANT_ID],
          // The reset landed after the spend, so nothing survives the floor
          // for that one bucket.
          boundaries: [
            {
              bucketScopeId: `${anchorId}:resetuser`,
              periodStartedAt: new Date(NOW.getTime() - 1_000),
            },
          ],
          now: NOW,
        });
      }, 120_000);

      /** @scenario "Resetting one end user's period drops them from the count until they spend again" */
      it("drops the reset end user from the count entirely", () => {
        expect(buckets.map((b) => b.scopeId)).not.toContain(
          `${anchorId}:resetuser`,
        );
      });

      /** @scenario "Resetting one end user's period drops them from the count until they spend again" */
      it("leaves every other end user's standing untouched", () => {
        expect(buckets).toHaveLength(1);
        expect(buckets[0]!.scopeId).toBe(`${anchorId}:untouched`);
        expect(overCap(buckets)).toBe(1);
      });
    });

    describe("when the template runs a MANUAL window whose boundary moved mid-period", () => {
      const anchorId = `vkanchor-manual-${suffix}`;
      const periodStartedAt = new Date(NOW.getTime() - 30 * 60_000);
      const template = templateFor({
        id: `bdg-manual-${suffix}`,
        anchorId,
        window: "MANUAL",
        currentPeriodStartedAt: periodStartedAt,
      });
      let buckets: BucketSpend[];

      beforeAll(async () => {
        // Before the boundary: forgiven, and invisible to the headcount.
        await debit({
          budgetId: template.id,
          bucketScopeId: `${anchorId}:stale`,
          amountNanoUsd: 5_000_000_000,
          window: "MANUAL",
          occurredAt: new Date(NOW.getTime() - 2 * 60 * 60_000),
        });
        await debit({
          budgetId: template.id,
          bucketScopeId: `${anchorId}:current`,
          amountNanoUsd: 400_000_000,
          window: "MANUAL",
          occurredAt: new Date(NOW.getTime() - 2 * 60 * 60_000),
        });
        // After it: the only spend this period owns.
        await debit({
          budgetId: template.id,
          bucketScopeId: `${anchorId}:current`,
          amountNanoUsd: 3_000_000_000,
          window: "MANUAL",
          occurredAt: new Date(NOW.getTime() - 60_000),
        });
        buckets = await repo.getBucketSpendBreakdownForBudget({
          budget: template,
          tenantIds: [TENANT_ID],
          boundaries: [],
          now: NOW,
        });
      }, 120_000);

      /** @scenario "A per-person template counts the people it has seen and the people over cap" */
      it("counts only the end users with spend after the boundary", () => {
        expect(buckets.map((b) => b.scopeId)).toEqual([`${anchorId}:current`]);
      });

      /** @scenario "A per-person template counts the people it has seen and the people over cap" */
      it("totals each surviving bucket from the boundary, not from the calendar", () => {
        expect(Number.parseFloat(buckets[0]!.spentUsd)).toBe(3);
        expect(overCap(buckets)).toBe(1);
      });
    });

    describe("when the template has seen nobody at all", () => {
      const template = templateFor({
        id: `bdg-empty-${suffix}`,
        anchorId: `vkanchor-empty-${suffix}`,
      });

      /** @scenario "A per-person template nobody has used yet says so instead of showing a dash" */
      it("returns no buckets rather than inventing one", async () => {
        const buckets = await repo.getBucketSpendBreakdownForBudget({
          budget: template,
          tenantIds: [TENANT_ID],
          boundaries: [],
          now: NOW,
        });
        expect(buckets).toEqual([]);
        expect(overCap(buckets)).toBe(0);
      });
    });
  },
);
