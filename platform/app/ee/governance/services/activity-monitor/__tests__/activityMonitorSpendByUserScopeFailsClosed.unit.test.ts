// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The scope decision has two halves, and they have to fail the same way.
 *
 * `spendByUser` resolves the tenant ids from the scope, and `findSpendByUser`
 * builds the SQL from the same scope a second time. Both halves default, and
 * they used to default in opposite directions: the service tested the
 * ORGANIZATION literal and fell back to the governance tenant ids, while the
 * repository tested the GOVERNANCE literal and fell back to the wide
 * `TenantId IN (...)` with the governance-source filter dropped. A value
 * matching neither literal therefore read the hidden governance project
 * through the organization SQL — a population neither branch intends, and one
 * no caller ever asked for.
 *
 * WHY A GUARD AND NOT JUST THE TYPE. The router's zod enum protects the four
 * screens and nothing else. `unsupportedValue.ts` states this directory's
 * rule: these services are deliberately reachable from more than the tRPC
 * routers, so every enum guard here rejects on its own — the guard
 * `anomalyRule.service.ts` and `ingestionSource.service.ts` already carry, and
 * the one the sibling `sortBy` in this very function has had all along
 * (`SORT_FIELD_TO_AGG_EXPR[sortBy] ?? SORT_FIELD_TO_AGG_EXPR.spend`).
 *
 * WHY THE REPOSITORY IS TESTED SEPARATELY FROM THE SERVICE. The service now
 * refuses an unmatched scope, so the repository cannot be reached through it
 * with one. That makes the repository's own fallback unreachable in this
 * process and load-bearing in the next: it is the second half of a decision
 * that must not drift back to defaulting wide. It is exercised directly, the
 * way `activityMonitorSpendByUserOriginFilter` exercises it.
 *
 * The casts below are the point of the test, not a shortcut around the types:
 * what is being proved is the behaviour when the type has been erased
 * upstream, which is the only way either fallback is ever reached.
 */
import { describe, expect, it, vi } from "vitest";
import type { ZodType } from "zod/v4";

import type { PrismaClient } from "~/generated/prisma/client";
import { activityMonitorRouter } from "../../../routers/activityMonitor";
import type { SpendByUserScope } from "../activityMonitor.clickhouse.schemas";
import { SPEND_BY_USER_SCOPES } from "../activityMonitor.clickhouse.schemas";
import { ActivityMonitorService } from "../activityMonitor.service";
import { ActivityMonitorSpendClickHouseRepository } from "../activityMonitor.spend.clickhouse.repository";

const GOV_PROJECT = "project-governance";
const APP_PROJECT = "project-assistants";

/** A scope that is not one of the two, as an erased caller would supply it. */
const UNMATCHED = "orginization" as unknown as SpendByUserScope;

const WINDOW_START = Date.UTC(2026, 0, 1);
const WINDOW_END = Date.UTC(2026, 1, 1);

/** Prisma stubbed to an organization holding the hidden project and one live. */
const prisma = {
  anomalyAlert: { groupBy: async () => [] },
  project: {
    findFirst: async () => ({ id: GOV_PROJECT }),
    findMany: async () => [
      { id: GOV_PROJECT, departmentId: null },
      { id: APP_PROJECT, departmentId: null },
    ],
  },
} as unknown as PrismaClient;

/** A repository that records whether it was reached at all. */
function makeRepository() {
  const calls: unknown[] = [];
  return {
    calls,
    repository: {
      findSpendByUser: (arg: unknown) => {
        calls.push(arg);
        return Promise.resolve([]);
      },
    } as never,
  };
}

/** The real repository over a mock ClickHouse client, plus the capturing spy. */
function makeRepo() {
  const query = vi.fn(async () => ({ json: async () => [] as unknown[] }));
  const ch = { query } as never;
  const repo = new ActivityMonitorSpendClickHouseRepository(async () => ch);
  return { repo, query };
}

type CapturedCall = {
  query: string;
  query_params: Record<string, unknown>;
};

const captured = (query: { mock: { calls: unknown[][] } }): CapturedCall =>
  query.mock.calls[0]?.[0] as CapturedCall;

const readWith = async (scope: SpendByUserScope) => {
  const { repo, query } = makeRepo();
  await repo.findSpendByUser({
    tenantIds: [GOV_PROJECT],
    scope,
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    sortBy: "tokens",
    sortDir: "desc",
    limit: 8,
    offset: 0,
  });
  return captured(query);
};

describe("a scope value that is neither of the two", () => {
  describe("when it reaches the per-person spend service", () => {
    it("is refused by name rather than read as some third population", async () => {
      const { repository, calls } = makeRepository();
      const service = new ActivityMonitorService({ prisma, repository });

      const refusal = await service
        .spendByUser({
          organizationId: "org-1",
          windowDays: 30,
          scope: UNMATCHED,
        })
        .then(
          () => null,
          (err: unknown) => err,
        );

      // The code, not the prose: the message is copy and will change.
      expect((refusal as { code?: string } | null)?.code).toBe(
        "validation_error",
      );
      // The complaint names the field and the values, because picking a listed
      // one is the entire remedy.
      expect(
        (refusal as { meta?: { formErrors?: string[] } }).meta?.formErrors?.[0],
      ).toContain("governance, organization");
      // And no read was issued at all — a refusal must not also query.
      expect(calls).toHaveLength(0);
    });
  });

  describe("when it reaches the repository with the type already erased", () => {
    it("builds the narrow governance SQL rather than the wide organization one", async () => {
      const call = await readWith(UNMATCHED);

      // Narrow: single-tenant equality, never the multi-tenant IN.
      expect(call.query).toContain("TenantId = {tenantId:String}");
      expect(call.query).not.toContain(
        "TenantId IN ({tenantIds:Array(String)})",
      );
      expect(call.query_params.tenantId).toBe(GOV_PROJECT);
      expect(call.query_params.tenantIds).toBeUndefined();

      // And the governance-source filter is still on. Dropping it while
      // keeping the governance tenant is the hybrid population this test
      // exists to forbid.
      expect(call.query).toContain("{originKey:String}");
      expect(call.query_params.originValue).toBe("ingestion_source");
    });

    it("emits byte-for-byte what a genuine governance call emits", async () => {
      const unmatched = await readWith(UNMATCHED);
      const governance = await readWith("governance");

      expect(unmatched.query).toBe(governance.query);
      expect(unmatched.query_params).toEqual(governance.query_params);
    });
  });
});

/**
 * The procedure's enum and the service's guard read the same list.
 *
 * `SpendByUserScope` used to be a hand-written union declared apart from the
 * procedure's hand-written `z.enum`, so a member added to the type compiled
 * everywhere while the procedure went on rejecting it. The sibling `sortBy`
 * can stay hand-written because `SORT_FIELD_TO_AGG_EXPR` is a `Record` over
 * `SpendByUserSortField` and a drifted member fails the build; nothing tied
 * the scope that way, which is why this is a test rather than a type.
 *
 * It asks the real procedure, not the source text: what is being pinned is
 * that the two ends agree on the values, whatever either is spelled like.
 */
describe("the scopes the procedure accepts", () => {
  /** The `spendByUser` procedure's zod input schema, as tRPC stores it. */
  const inputSchema = (): ZodType | undefined => {
    const proc = (activityMonitorRouter as unknown as Record<string, unknown>)
      .spendByUser as { _def: { inputs: ZodType[] } };
    return proc._def.inputs[0];
  };

  const parseWithScope = (schema: ZodType, scope: string) =>
    schema.safeParse({ organizationId: "org-1", windowDays: 30, scope });

  it("is every scope the service is allowed to be handed, and no more", () => {
    const schema = inputSchema();

    // The self-checks. A procedure that stopped declaring an input, or a list
    // that emptied, would make every assertion below vacuous rather than fail.
    expect(schema).toBeDefined();
    expect(SPEND_BY_USER_SCOPES.length).toBeGreaterThan(1);

    for (const scope of SPEND_BY_USER_SCOPES) {
      expect(parseWithScope(schema as ZodType, scope).success, scope).toBe(
        true,
      );
    }
    expect(parseWithScope(schema as ZodType, UNMATCHED).success).toBe(false);
  });
});

describe("the SQL a genuine governance call sends", () => {
  /**
   * Pinned whole, not by fragment. Three screens still lead with dollars off
   * this read, so any edit to the scope branching that moves one character of
   * their query has to be a deliberate one.
   *
   * The flip that introduced this file could not have moved a character: the
   * governance fragments are the same string literals either way, and only
   * the ternary arms swapped. The snapshot's job is the NEXT edit, which has
   * no such guarantee. It was written by running this test against the
   * pre-flip repository, so it is the old query rather than a transcript of
   * the new one — but read it as a pin on the future, not as evidence about
   * the past.
   *
   * The annotation below closes its own comment on purpose. `isFollowedByTestCall`
   * starts its walk at the end of the match and cannot leave a comment it begins
   * inside, so an annotation opening this block would bind nothing and say
   * nothing about it — see `scripts/check-feature-parity.ts:1151`.
   */
  /** @scenario "A reader of the person figures other than the cost screen keeps the governance scope" */
  it("is unchanged, character for character", async () => {
    const call = await readWith("governance");

    expect(call.query).toMatchInlineSnapshot(`
      "
              SELECT
                actor,
                toString(sum(spendUsd)) AS spendUsdStr,
                toString(count()) AS requests,
                toString(toUnixTimestamp64Milli(max(occurredAt))) AS lastActivityMs,
                any(model) AS mostUsedTarget,
                -- NULL, not 0, when no trace of theirs carried a count: both token
                -- columns are Nullable(UInt32) and a subscription product can leave
                -- them unset. Same expressions as the department read, on the same
                -- table, so the two panels cannot drift on what a token is.
                if(
                  countIf(promptTokens IS NOT NULL OR completionTokens IS NOT NULL) = 0,
                  NULL,
                  toString(sum(coalesce(promptTokens, 0) + coalesce(completionTokens, 0)))
                ) AS tokensStr,
                toString(toUInt8(maxIf(
                  tokensEstimated,
                  promptTokens IS NOT NULL OR completionTokens IS NOT NULL
                ))) AS tokensEstimatedStr
              FROM (
                SELECT
                  ts.Attributes[{userKey:String}] AS actor,
                  coalesce(ts.TotalCost, 0) AS spendUsd,
                  ts.OccurredAt AS occurredAt,
                  arrayElement(ts.Models, 1) AS model,
                  ts.TotalPromptTokenCount AS promptTokens,
                  ts.TotalCompletionTokenCount AS completionTokens,
                  ts.TokensEstimated AS tokensEstimated
                FROM trace_summaries ts
                WHERE ts.TenantId = {tenantId:String}
                  AND ts.OccurredAt >= fromUnixTimestamp64Milli({windowStart:UInt64})
                  AND ts.OccurredAt < fromUnixTimestamp64Milli({windowEnd:UInt64})
                  AND ts.Attributes[{originKey:String}] = {originValue:String}
                  AND ts.Attributes[{userKey:String}] != ''
                  AND (ts.TenantId, ts.TraceId, ts.UpdatedAt) IN (
                    SELECT TenantId, TraceId, max(UpdatedAt)
                    FROM trace_summaries
                    WHERE TenantId = {tenantId:String}
                      AND OccurredAt >= fromUnixTimestamp64Milli({windowStart:UInt64})
                      AND OccurredAt < fromUnixTimestamp64Milli({windowEnd:UInt64})
                    GROUP BY TenantId, TraceId
                  )
              )
              GROUP BY actor
              ORDER BY sum(coalesce(promptTokens, 0) + coalesce(completionTokens, 0)) DESC
              LIMIT {limit:UInt32} OFFSET {offset:UInt32}
            "
    `);
    expect(call.query_params).toMatchInlineSnapshot(`
      {
        "limit": 8,
        "offset": 0,
        "originKey": "langwatch.origin.kind",
        "originValue": "ingestion_source",
        "tenantId": "project-governance",
        "userKey": "langwatch.user_id",
        "windowEnd": 1769904000000,
        "windowStart": 1767225600000,
      }
    `);
  });
});
