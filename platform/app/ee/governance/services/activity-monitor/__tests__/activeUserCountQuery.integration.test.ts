// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The adoption headcount query, executed.
 *
 * `findActiveUserCount` answers both windows of the cost screen's adoption
 * card from one read: two `uniqExactIf` aggregates over a range spanning the
 * current window and the one before it, across every live project of the
 * organization. Every other test of this read asserts on the SQL string it
 * hands ClickHouse, which cannot tell a correct query from one that parses
 * and answers wrongly — or from one ClickHouse rejects outright. This runs it
 * against a real instance and checks the counts.
 *
 * Three things can only be proved here:
 *   - the two windows are split at `thisStart` and not double-counted, so
 *     somebody active in both is one person in each figure rather than two;
 *   - the dedup subquery picks the latest version of a trace, so a superseded
 *     row's attributes do not contribute a person who is not there;
 *   - the tenant list widens the read, so a person who only ever worked in a
 *     second project of the organization is counted.
 *
 * Seeds ClickHouse directly rather than driving the trace pipeline: the read
 * is the subject, and a seeded row is deterministic where a fold is not. The
 * same choice, for the same reason, as
 * `ee/governance/services/__tests__/activityMonitor.service.integration.test.ts`.
 *
 * Spec: specs/governance/governance-cost-screen.feature — rule "Adoption
 * counts the people of the whole organization".
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  cleanupTestData,
  getTestClickHouseClient,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { ActivityMonitorSpendClickHouseRepository } from "../activityMonitor.spend.clickhouse.repository";

const ORIGIN_KEY = "langwatch.origin.kind";
const ORIGIN_VALUE = "ingestion_source";
const USER_KEY = "langwatch.user_id";

const DAY_MS = 24 * 60 * 60 * 1000;

const namespace = `active-users-${nanoid(8)}`;
/** Two live projects of one organization — the read spans both. */
const TENANT_A = `tenant-a-${namespace}`;
const TENANT_B = `tenant-b-${namespace}`;

const now = Date.now();
const windowEnd = now;
const thisStart = now - 7 * DAY_MS;
const prevStart = now - 14 * DAY_MS;

const IN_THIS_WINDOW = new Date(now - 1 * DAY_MS);
const IN_PREVIOUS_WINDOW = new Date(now - 10 * DAY_MS);
const BEFORE_BOTH_WINDOWS = new Date(now - 20 * DAY_MS);

let ch: ClickHouseClient;
let repository: ActivityMonitorSpendClickHouseRepository;

/**
 * Seeds one governance-origin trace summary.
 *
 * `traceId` and `updatedAt` are explicit because the dedup case needs two
 * rows that share a trace and disagree on which is current.
 */
async function seedTrace({
  tenantId,
  userId,
  occurredAt,
  traceId = `tr-${nanoid()}`,
  updatedAt = occurredAt,
  governanceOrigin = true,
}: {
  tenantId: string;
  userId: string;
  occurredAt: Date;
  traceId?: string;
  updatedAt?: Date;
  governanceOrigin?: boolean;
}): Promise<void> {
  await ch.insert({
    table: "trace_summaries",
    values: [
      {
        ProjectionId: `proj-${nanoid()}`,
        TenantId: tenantId,
        TraceId: traceId,
        Version: "v1",
        Attributes: {
          ...(governanceOrigin ? { [ORIGIN_KEY]: ORIGIN_VALUE } : {}),
          [USER_KEY]: userId,
        },
        OccurredAt: occurredAt,
        CreatedAt: occurredAt,
        UpdatedAt: updatedAt,
        ComputedIOSchemaVersion: "",
        ComputedInput: null,
        ComputedOutput: null,
        TimeToFirstTokenMs: null,
        TimeToLastTokenMs: null,
        TotalDurationMs: 100,
        TokensPerSecond: null,
        SpanCount: 1,
        ContainsErrorStatus: 0,
        ContainsOKStatus: 1,
        ErrorMessage: null,
        Models: ["claude-sonnet-4"],
        TotalCost: 0.5,
        TokensEstimated: false,
        TotalPromptTokenCount: 100,
        TotalCompletionTokenCount: 50,
        OutputFromRootSpan: 0,
        OutputSpanEndTimeMs: 0,
        BlockedByGuardrail: 0,
        TopicId: null,
        SubTopicId: null,
        HasAnnotation: null,
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

beforeAll(async () => {
  const maybeCh = getTestClickHouseClient();
  if (!maybeCh) throw new Error("ClickHouse test container not available");
  ch = maybeCh;
  repository = new ActivityMonitorSpendClickHouseRepository(async () => ch);

  // First project: one person in this window only, one in the previous
  // window only, one in both, and one whose two traces must not make them
  // two people.
  await seedTrace({
    tenantId: TENANT_A,
    userId: "this-window-only@example.com",
    occurredAt: IN_THIS_WINDOW,
  });
  await seedTrace({
    tenantId: TENANT_A,
    userId: "previous-window-only@example.com",
    occurredAt: IN_PREVIOUS_WINDOW,
  });
  await seedTrace({
    tenantId: TENANT_A,
    userId: "both-windows@example.com",
    occurredAt: IN_THIS_WINDOW,
  });
  await seedTrace({
    tenantId: TENANT_A,
    userId: "both-windows@example.com",
    occurredAt: IN_PREVIOUS_WINDOW,
  });
  await seedTrace({
    tenantId: TENANT_A,
    userId: "this-window-only@example.com",
    occurredAt: IN_THIS_WINDOW,
  });

  // Second project of the same organization: somebody who never appears in
  // the first one, so a read that forgot the tenant list loses them.
  await seedTrace({
    tenantId: TENANT_B,
    userId: "other-project@example.com",
    occurredAt: IN_THIS_WINDOW,
  });

  // Traffic that is not assistant traffic. The origin marker is what the
  // headcount means by "using AI tools", so this person is not one.
  await seedTrace({
    tenantId: TENANT_A,
    userId: "application-traffic@example.com",
    occurredAt: IN_THIS_WINDOW,
    governanceOrigin: false,
  });

  // Older than both windows. Counted in neither figure.
  await seedTrace({
    tenantId: TENANT_A,
    userId: "long-departed@example.com",
    occurredAt: BEFORE_BOTH_WINDOWS,
  });

  // One trace, twice: an early version attributed to one person and the
  // current version attributed to another. Only the current one is real.
  const supersededTraceId = `tr-superseded-${nanoid()}`;
  await seedTrace({
    tenantId: TENANT_A,
    userId: "superseded-attribution@example.com",
    occurredAt: IN_THIS_WINDOW,
    traceId: supersededTraceId,
    updatedAt: new Date(now - 2 * DAY_MS),
  });
  await seedTrace({
    tenantId: TENANT_A,
    userId: "current-attribution@example.com",
    occurredAt: IN_THIS_WINDOW,
    traceId: supersededTraceId,
    updatedAt: new Date(now - 1 * DAY_MS),
  });
});

afterAll(async () => {
  await cleanupTestData(TENANT_A);
  await cleanupTestData(TENANT_B);
});

describe("the adoption headcount read", () => {
  describe("given people active in this window, the window before it, and both", () => {
    /** @scenario "Each window counts its own people across every project of the organization" */
    it("counts each window's people once, across every project handed in", async () => {
      const row = await repository.findActiveUserCount({
        tenantIds: [TENANT_A, TENANT_B],
        thisStart,
        prevStart,
        windowEnd,
      });

      // this-window-only, both-windows, other-project (second tenant),
      // current-attribution. Not application-traffic (no origin marker),
      // not long-departed (older than both windows), and
      // this-window-only is one person despite two traces.
      expect(row.thisUsers).toBe(4);

      // previous-window-only and both-windows. The person active in both is
      // one person here and one person above, not two in either.
      expect(row.prevUsers).toBe(2);
    });
  });

  describe("given a trace whose current version attributes it to a different person", () => {
    /** @scenario "A superseded version of a trace does not add a person" */
    it("counts the person on the current version and not the one it replaced", async () => {
      const row = await repository.findActiveUserCount({
        tenantIds: [TENANT_A],
        thisStart,
        prevStart,
        windowEnd,
      });

      // Three in this tenant: this-window-only, both-windows, and the
      // current attribution of the superseded trace. A read that skipped
      // the dedup would find four.
      expect(row.thisUsers).toBe(3);
    });
  });

  describe("given an organization whose projects hold no assistant traffic at all", () => {
    /** @scenario "An organization with no traffic reports nobody in either window" */
    it("answers zero for both windows rather than failing", async () => {
      const row = await repository.findActiveUserCount({
        tenantIds: [`tenant-empty-${namespace}`],
        thisStart,
        prevStart,
        windowEnd,
      });

      expect(row.thisUsers).toBe(0);
      expect(row.prevUsers).toBe(0);
    });
  });
});
