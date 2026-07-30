/**
 * @vitest-environment node
 *
 * End-to-end integration test for the trace-driven budget ledger.
 *
 * Exercises the full write-and-read loop with REAL PG + REAL CH, NO MOCKS:
 *
 *   projection.map(span_received)      → GatewayBudgetDebitRecord
 *     → store.append()                 → resolve budgets (PG) → insertDebit()
 *     → gateway_budget_ledger_events   (ReplacingMergeTree)
 *     → MV fires into gateway_budget_scope_totals (AggregatingMergeTree)
 *     → GatewayBudgetService.check()   reads via sumMerge(SpendUSD)
 *     → decision reflects the recorded spend
 *
 * This covers the gap rchaves flagged on iter 110: "full e2e integration
 * tests for the event sourcing for the budget, FROM a trace being
 * collected TO the budget increasing. DO NOT mock anything."
 *
 * Scope kept tight: the projection's `map` is called directly with a
 * wire-shaped `span_received` event, bypassing the queue and the rest of the
 * trace-processing pipeline. The pipeline itself is covered by its own
 * integration suite; this test proves only the projection+CH+service triangle.
 *
 * **What ADR-075 Class C (retired; ground now ADR-098) changed under these
 * tests.** They used to drive
 * `gatewayBudgetSync`, a reactor that folded TRACE state and swallowed every
 * failure. It is now a map projection over SPANS with an append store that
 * throws, plus a `virtualKeyLastUsed` subscriber for the one thing in the old
 * handler that was a best-effort Postgres side effect rather than derived
 * state. Two consequences are asserted below rather than assumed: a ClickHouse
 * failure is now REPORTED (so the map job retries) instead of silently
 * deleting spend, and the `BUDGET_UPDATED` notification is gated on a write
 * having actually landed (so replaying a window cannot flood the gateway's
 * revision feed).
 */

import type { GatewayBudgetDebitRecord } from "@ee/governance/projections/gatewayBudgetDebits.mapProjection";
import { createGatewayBudgetDebitsProjection } from "@ee/governance/projections/governanceProjections.composition";
import { createVirtualKeyLastUsedSubscriber } from "@ee/governance/subscribers/virtualKeyLastUsed.subscriber";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing.old/__tests__/integration/testContainers";
import { createTenantId } from "~/server/event-sourcing.old/domain/tenantId";
import {
  createSpanReceivedEvent,
  msToUnixNano,
} from "~/server/event-sourcing.old/pipelines/trace-processing/projections/__tests__/fixtures/trace-summary-test.fixtures";
import type {
  SpanReceivedEvent,
  TraceProcessingEvent,
} from "~/server/event-sourcing.old/pipelines/trace-processing/schemas/events";
import { GatewayBudgetClickHouseRepository } from "../budget.clickhouse.repository";
import { GatewayBudgetRepository } from "../budget.repository";
import { GatewayBudgetService } from "../budget.service";
import { ChangeEventRepository } from "../changeEvent.repository";

const suffix = nanoid(8);
const ORG_ID = `org-${suffix}`;
const TEAM_ID = `team-${suffix}`;
const PROJECT_ID = `proj-${suffix}`;
const USER_ID = `usr-${suffix}`;
const VK_ID = `vk_${suffix}`;
const BUDGET_ID = `bdg-${suffix}`;

/** A second organization, so a forged cross-tenant debit has somewhere to come from. */
const OTHER_ORG_ID = `org-other-${suffix}`;
const OTHER_TEAM_ID = `team-other-${suffix}`;
const OTHER_PROJECT_ID = `proj-other-${suffix}`;
const OTHER_USER_ID = `usr-other-${suffix}`;
const OTHER_VK_ID = `vk_other_${suffix}`;

/**
 * The projection prices a request off the span's own provider-reported tokens
 * and the per-token rates on it, so a test states a cost by stating those.
 * `pricingFor` splits the target cost evenly across the two rates, so $0.0125
 * is stated as $6.25e-6 per input token and $1.25e-5 per output token — the
 * same figure the reactor's tests asserted when they handed the fold a
 * `totalCost` directly.
 */
const DEFAULT_COST_USD = 0.0125;
const INPUT_TOKENS = 1000;
const OUTPUT_TOKENS = 500;

function pricingFor(costUsd: number): Record<string, string | number> {
  // Split the target cost evenly across the two rates so both are exercised.
  return {
    "gen_ai.request.model": "gpt-5-mini",
    "gen_ai.usage.input_tokens": INPUT_TOKENS,
    "gen_ai.usage.output_tokens": OUTPUT_TOKENS,
    "langwatch.model.inputCostPerToken": costUsd / 2 / INPUT_TOKENS,
    "langwatch.model.outputCostPerToken": costUsd / 2 / OUTPUT_TOKENS,
  };
}

/**
 * One gateway span, as it arrives on the wire.
 *
 * `startedAtMs` defaults to now on purpose: the span's own start time is what
 * the rollup buckets `PeriodStart` from, so a debit stamped at the fixture's
 * canned 2023 timestamp would land in a period this month's budget never
 * reads and every spend assertion below would read zero.
 */
function gatewaySpanEvent({
  gatewayRequestId,
  virtualKeyId = VK_ID,
  tenantId = PROJECT_ID,
  costUsd = DEFAULT_COST_USD,
  startedAtMs = Date.now(),
}: {
  gatewayRequestId: string;
  virtualKeyId?: string;
  tenantId?: string;
  costUsd?: number;
  startedAtMs?: number;
}): SpanReceivedEvent {
  return createSpanReceivedEvent({
    eventId: `evt-${nanoid()}`,
    tenantId,
    traceId: nanoid(32),
    spanId: nanoid(16),
    startTimeUnixNano: msToUnixNano(startedAtMs),
    endTimeUnixNano: msToUnixNano(startedAtMs + 1234),
    statusCode: 1,
    attributes: {
      ...pricingFor(costUsd),
      "langwatch.virtual_key_id": virtualKeyId,
      "langwatch.gateway_request_id": gatewayRequestId,
    },
  });
}

/** The test-container ClickHouse, resolved for any tenant. */
function testClickHouseRepository(): GatewayBudgetClickHouseRepository {
  return new GatewayBudgetClickHouseRepository(async () => {
    const { getTestClickHouseClient } = await import(
      "~/server/event-sourcing.old/__tests__/integration/testContainers"
    );
    const client = getTestClickHouseClient();
    if (!client) throw new Error("Test CH client not initialised");
    return client;
  });
}

function budgetDebitsProjection(
  budgetCHRepository: GatewayBudgetClickHouseRepository,
) {
  return createGatewayBudgetDebitsProjection({
    prisma,
    budgetRepository: new GatewayBudgetRepository(prisma),
    budgetCHRepository,
    changeEvents: new ChangeEventRepository(prisma),
  });
}

/** Derive one span's debit and write it, as the live per-event path does. */
async function derive(
  projection: ReturnType<typeof budgetDebitsProjection>,
  event: SpanReceivedEvent,
): Promise<void> {
  const record = projection.map(event);
  if (!record) throw new Error("gateway span derived no debit record");
  await projection.store.append(record, {
    aggregateId: event.aggregateId,
    tenantId: createTenantId(event.tenantId),
  });
}

/** Derive a window of spans and write them as replay's bulk path does. */
async function deriveWindow(
  projection: ReturnType<typeof budgetDebitsProjection>,
  events: SpanReceivedEvent[],
): Promise<void> {
  const records = events
    .map((event) => projection.map(event))
    .filter((record): record is GatewayBudgetDebitRecord => record !== null);
  await projection.store.bulkAppend!(records, {
    tenantId: createTenantId(PROJECT_ID),
  });
}

async function projectSpend(
  budgetCHRepository: GatewayBudgetClickHouseRepository,
): Promise<number> {
  const service = GatewayBudgetService.create(prisma, budgetCHRepository);
  const result = await service.check({
    organizationId: ORG_ID,
    teamId: TEAM_ID,
    projectId: PROJECT_ID,
    virtualKeyId: VK_ID,
    principalUserId: USER_ID,
    projectedCostUsd: 0,
  });
  const projectScope = result.scopes.find(
    (s) => s.scope === "project" && s.scopeId === PROJECT_ID,
  );
  return Number.parseFloat(projectScope?.spentUsd ?? "0");
}

async function budgetUpdatedCount(): Promise<number> {
  return await prisma.gatewayChangeEvent.count({
    where: { organizationId: ORG_ID, kind: "BUDGET_UPDATED" },
  });
}

describe("gatewayBudgetDebits projection — real PG + real CH", () => {
  beforeAll(async () => {
    await startTestContainers();

    // Seed PG fixture: org → team → project → user → VK → Budget
    await prisma.organization.create({
      data: { id: ORG_ID, name: `Org ${suffix}`, slug: `org-${suffix}` },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `Team ${suffix}`,
        slug: `team-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: `Project ${suffix}`,
        slug: `proj-${suffix}`,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `key-${suffix}`,
      },
    });
    await prisma.user.create({
      data: { id: USER_ID, email: `${suffix}@test.local`, name: "Test" },
    });
    await prisma.virtualKey.create({
      data: {
        id: VK_ID,
        organizationId: ORG_ID,
        name: "test-vk",
        hashedSecret: `hash-${suffix}`,
        displayPrefix: "vk-lw-xxx",
        principalUserId: USER_ID,
        createdById: USER_ID,
        scopes: {
          create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
        },
      },
    });
    await prisma.gatewayBudget.create({
      data: {
        id: BUDGET_ID,
        name: `Test budget ${suffix}`,
        organizationId: ORG_ID,
        scopeType: "PROJECT",
        scopeId: PROJECT_ID,
        window: "MONTH",
        limitUsd: "1.00",
        onBreach: "BLOCK",
        createdById: USER_ID,
        resetsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    // A second org whose key can be NAMED by a span landing in the first org's
    // project. `langwatch.virtual_key_id` is customer-writable, so this is a
    // shape any tenant can produce.
    await prisma.organization.create({
      data: {
        id: OTHER_ORG_ID,
        name: `Other org ${suffix}`,
        slug: `org-other-${suffix}`,
      },
    });
    await prisma.team.create({
      data: {
        id: OTHER_TEAM_ID,
        name: `Other team ${suffix}`,
        slug: `team-other-${suffix}`,
        organizationId: OTHER_ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: OTHER_PROJECT_ID,
        name: `Other project ${suffix}`,
        slug: `proj-other-${suffix}`,
        teamId: OTHER_TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `key-other-${suffix}`,
      },
    });
    await prisma.user.create({
      data: {
        id: OTHER_USER_ID,
        email: `other-${suffix}@test.local`,
        name: "Other",
      },
    });
    await prisma.virtualKey.create({
      data: {
        id: OTHER_VK_ID,
        organizationId: OTHER_ORG_ID,
        name: "other-vk",
        hashedSecret: `hash-other-${suffix}`,
        displayPrefix: "vk-lw-oth",
        principalUserId: OTHER_USER_ID,
        createdById: OTHER_USER_ID,
        scopes: {
          create: [{ scopeType: "PROJECT", scopeId: OTHER_PROJECT_ID }],
        },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.gatewayChangeEvent.deleteMany({
      where: { organizationId: { in: [ORG_ID, OTHER_ORG_ID] } },
    });
    await prisma.gatewayBudget.deleteMany({ where: { id: BUDGET_ID } });
    // Post-collapse VirtualKey is org-scoped. The dbMTP SCOPED_MODELS
    // guard accepts a row id as the tenancy proof for single-row writes.
    await prisma.virtualKey.deleteMany({ where: { id: VK_ID } });
    await prisma.virtualKey.deleteMany({ where: { id: OTHER_VK_ID } });
    await prisma.user.deleteMany({
      where: { id: { in: [USER_ID, OTHER_USER_ID] } },
    });
    await prisma.project.deleteMany({
      where: { id: { in: [PROJECT_ID, OTHER_PROJECT_ID] } },
    });
    await prisma.team.deleteMany({
      where: { id: { in: [TEAM_ID, OTHER_TEAM_ID] } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [ORG_ID, OTHER_ORG_ID] } },
    });
    await stopTestContainers();
  }, 60_000);

  describe("when a gateway span is derived into the ledger", () => {
    it("lands the spend and /budget/check reflects it", async () => {
      const chRepo = testClickHouseRepository();

      await derive(
        budgetDebitsProjection(chRepo),
        gatewaySpanEvent({ gatewayRequestId: `req-${suffix}-1` }),
      );

      // Read via service — this exercises the full /budget/check CH path
      const service = GatewayBudgetService.create(prisma, chRepo);
      const result = await service.check({
        organizationId: ORG_ID,
        teamId: TEAM_ID,
        projectId: PROJECT_ID,
        virtualKeyId: VK_ID,
        principalUserId: USER_ID,
        projectedCostUsd: 0,
      });

      const projectScope = result.scopes.find(
        (s) => s.scope === "project" && s.scopeId === PROJECT_ID,
      );
      expect(projectScope).toBeDefined();
      expect(Number.parseFloat(projectScope!.spentUsd)).toBeCloseTo(
        DEFAULT_COST_USD,
        4,
      );
      expect(result.decision).toBe("allow");
      expect(result.warnings).toHaveLength(0);
    }, 60_000);

    /**
     * The gateway authorises against a cached bundle whose `SpentMicroUSD` is
     * frozen at populate time, so a debit nobody announces is a debit the
     * gateway keeps serving past.
     */
    it("tells the gateway that spend moved", async () => {
      const changes = await prisma.gatewayChangeEvent.findMany({
        where: { organizationId: ORG_ID, kind: "BUDGET_UPDATED" },
        orderBy: { revision: "asc" },
      });

      expect(changes).toHaveLength(1);
      expect(changes[0]!.projectId).toBe(PROJECT_ID);
      expect(changes[0]!.payload).toMatchObject({
        gatewayRequestId: `req-${suffix}-1`,
        virtualKeyId: VK_ID,
        budgetIds: [BUDGET_ID],
      });
    }, 60_000);
  });

  describe("when the same gateway request is derived again", () => {
    it("charges the budget once, not once per delivery", async () => {
      const chRepo = testClickHouseRepository();
      const projection = budgetDebitsProjection(chRepo);
      const before = await projectSpend(chRepo);
      const changesBefore = await budgetUpdatedCount();

      // Three deliveries of one request. Each is a separately-derived record
      // — a replay produces new event ids and new span envelopes, and only
      // the gateway request id is stable — so this is the shape a redelivery
      // actually has, not the same object handed over three times.
      const reqId = `req-${suffix}-idempotent`;
      await derive(projection, gatewaySpanEvent({ gatewayRequestId: reqId }));
      await derive(projection, gatewaySpanEvent({ gatewayRequestId: reqId }));
      await derive(projection, gatewaySpanEvent({ gatewayRequestId: reqId }));

      // One request's cost, not three. If the ledger's replay guard failed
      // we would see 3 x $0.0125 here.
      expect((await projectSpend(chRepo)) - before).toBeCloseTo(
        DEFAULT_COST_USD,
        4,
      );
      // Only the delivery that actually wrote announces: the two that found
      // the ledger already intact wrote nothing, so exactly one
      // BUDGET_UPDATED joins the count. Ungated, a replay of a window would
      // append a change row per historical request and sweep every VK's cache
      // in the project.
      expect(await budgetUpdatedCount()).toBe(changesBefore + 1);
    }, 60_000);
  });

  // ==========================================================================
  // Backpressure scenarios — measure-and-pin current behaviour under load.
  // Pure characterization; no new mechanism shipped here (timeouts, retries,
  // bounded queues are post-merge follow-ups).
  // ==========================================================================

  it("burst: 100 distinct spans derived in parallel — all spend reflects in /budget/check", async () => {
    const chRepo = testClickHouseRepository();
    const projection = budgetDebitsProjection(chRepo);

    // Capture pre-burst baseline so we measure the delta this test
    // contributed (prior tests may have left spend in CH).
    const baselineSpent = await projectSpend(chRepo);

    // 100 distinct requests, each 0.0001 cost (so total 0.01 — well
    // under the 1.00 budget even with prior-test accumulation).
    const N = 100;
    const PER_REQUEST_COST = 0.0001;
    const start = Date.now();
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        derive(
          projection,
          gatewaySpanEvent({
            gatewayRequestId: `req-${suffix}-burst-${i}`,
            costUsd: PER_REQUEST_COST,
          }),
        ),
      ),
    );
    const elapsedMs = Date.now() - start;
    // eslint-disable-next-line no-console
    console.log(
      `[projection-backpressure] burst N=${N} distinct spans in ${elapsedMs}ms (${(elapsedMs / N).toFixed(1)}ms/span avg)`,
    );

    const delta = (await projectSpend(chRepo)) - baselineSpent;

    // 100 × 0.0001 = 0.01 expected. Accept tiny floating-point drift
    // from CH Decimal(18, 10) round-trip.
    expect(delta).toBeCloseTo(N * PER_REQUEST_COST, 4);
  }, 60_000);

  describe("when ClickHouse rejects the write", () => {
    /**
     * The reactor this replaced caught the failure, logged "failed to fold
     * gateway trace into CH budget ledger", and returned cleanly — so a CH
     * blip silently deleted spend that had already been incurred, and nothing
     * ever retried it. Both of that reactor's failure modes pushed measured
     * spend DOWN, which is the wrong direction for a control whose job is to
     * stop spending. The store now propagates, so the map job retries and, if
     * every retry fails, a replay of the window re-derives the debit.
     */
    it("reports the failure rather than swallowing the spend", async () => {
      const failingChRepo = {
        insertDebit: async () => {
          throw new Error("simulated ClickHouse insert failure");
        },
      } as unknown as GatewayBudgetClickHouseRepository;
      const projection = budgetDebitsProjection(failingChRepo);
      const event = gatewaySpanEvent({
        gatewayRequestId: `req-${suffix}-ch-error`,
        costUsd: 0.0001,
      });

      await expect(derive(projection, event)).rejects.toThrow(
        "simulated ClickHouse insert failure",
      );
    }, 30_000);

    /** @scenario "Spend recorded during a failure still counts against the budget" */
    it("leaves the debit re-derivable, so the retry can still record it", async () => {
      const chRepo = testClickHouseRepository();
      const projection = budgetDebitsProjection(chRepo);
      const before = await projectSpend(chRepo);

      // The retry: the same gateway request, derived again from its span,
      // against a healthy ledger.
      await derive(
        projection,
        gatewaySpanEvent({
          gatewayRequestId: `req-${suffix}-ch-error`,
          costUsd: 0.0001,
        }),
      );

      expect((await projectSpend(chRepo)) - before).toBeCloseTo(0.0001, 5);
    }, 60_000);
  });

  describe("when one gateway request is replayed many times over", () => {
    /**
     * App-side dedup at insertDebit (probe SELECT before INSERT,
     * budget.clickhouse.repository.ts) collapses sequential replays of the
     * same gateway_request_id. The "charges the budget once" test above proves
     * 3 sequential deliveries = 1 effective row; this extends to 50 to pin the
     * contract under heavier replay pressure (e.g. a worker that retries the
     * same span 50 times after a pipeline restart).
     *
     * Note on PARALLEL same-id fires: probe-then-insert is not race-free under
     * TRUE parallelism — N concurrent invocations may all probe an empty
     * ledger before any insert lands, then all insert. The projection routes
     * each span to its own queue group, so same-request concurrency is
     * possible in principle; the probe-race characterisation is a follow-up
     * perf row and this scenario intentionally does NOT assert against it.
     */
    it("charges it exactly once", async () => {
      const chRepo = testClickHouseRepository();
      const projection = budgetDebitsProjection(chRepo);
      const baselineSpent = await projectSpend(chRepo);

      const reqId = `req-${suffix}-replay-burst`;
      const N = 50;
      for (let i = 0; i < N; i++) {
        await derive(
          projection,
          gatewaySpanEvent({ gatewayRequestId: reqId, costUsd: 0.0001 }),
        );
      }

      // 50 SEQUENTIAL deliveries of the SAME gateway_request_id → only
      // 0.0001 counts (not 50 × 0.0001). If app-side probe dedup
      // failed we'd see delta ≈ 0.005 instead of ≈ 0.0001.
      expect((await projectSpend(chRepo)) - baselineSpent).toBeCloseTo(
        0.0001,
        4,
      );
    }, 60_000);
  });

  describe("when a replay flushes a whole window through the batch path", () => {
    const WINDOW_SIZE = 10;
    const PER_REQUEST_COST = 0.0001;
    const windowRequestIds = Array.from(
      { length: WINDOW_SIZE },
      (_, i) => `req-${suffix}-window-${i}`,
    );

    it("charges every request in the window", async () => {
      const chRepo = testClickHouseRepository();
      const projection = budgetDebitsProjection(chRepo);
      const baselineSpent = await projectSpend(chRepo);

      await deriveWindow(
        projection,
        windowRequestIds.map((gatewayRequestId) =>
          gatewaySpanEvent({ gatewayRequestId, costUsd: PER_REQUEST_COST }),
        ),
      );

      expect((await projectSpend(chRepo)) - baselineSpent).toBeCloseTo(
        WINDOW_SIZE * PER_REQUEST_COST,
        4,
      );
    }, 60_000);

    it("re-flushing the same window charges nothing more", async () => {
      const chRepo = testClickHouseRepository();
      const projection = budgetDebitsProjection(chRepo);
      const baselineSpent = await projectSpend(chRepo);
      const changesBefore = await budgetUpdatedCount();

      await deriveWindow(
        projection,
        windowRequestIds.map((gatewayRequestId) =>
          gatewaySpanEvent({ gatewayRequestId, costUsd: PER_REQUEST_COST }),
        ),
      );

      expect((await projectSpend(chRepo)) - baselineSpent).toBeCloseTo(0, 5);
      // A rebuild over an intact ledger is silent: nothing was repaired, so
      // there is nothing to tell the gateway about.
      expect(await budgetUpdatedCount()).toBe(changesBefore);
    }, 60_000);

    it("repairs only the debit that went missing, and announces only that one", async () => {
      const chRepo = testClickHouseRepository();
      const projection = budgetDebitsProjection(chRepo);
      const baselineSpent = await projectSpend(chRepo);
      const changesBefore = await budgetUpdatedCount();
      const lostRequestId = `req-${suffix}-window-lost`;

      await deriveWindow(
        projection,
        [...windowRequestIds, lostRequestId].map((gatewayRequestId) =>
          gatewaySpanEvent({ gatewayRequestId, costUsd: PER_REQUEST_COST }),
        ),
      );

      expect((await projectSpend(chRepo)) - baselineSpent).toBeCloseTo(
        PER_REQUEST_COST,
        5,
      );
      expect(await budgetUpdatedCount()).toBe(changesBefore + 1);
    }, 60_000);
  });

  describe("when a span names a virtual key from another organization", () => {
    /**
     * `langwatch.virtual_key_id` arrives on a customer-written span attribute
     * and is not in the reserved namespace the receiver strips, so any tenant
     * can name any VK id. The multitenancy middleware does not catch it
     * either: VirtualKey's validateWhere accepts a bare row id as tenancy
     * proof. Without the guard, one org's traffic burns another org's budget.
     */
    it("refuses to move that organization's budget", async () => {
      const chRepo = testClickHouseRepository();
      const projection = budgetDebitsProjection(chRepo);
      const baselineSpent = await projectSpend(chRepo);
      const changesBefore = await budgetUpdatedCount();

      await derive(
        projection,
        gatewaySpanEvent({
          gatewayRequestId: `req-${suffix}-cross-tenant`,
          virtualKeyId: OTHER_VK_ID,
          costUsd: 0.5,
        }),
      );

      expect((await projectSpend(chRepo)) - baselineSpent).toBeCloseTo(0, 5);
      expect(await budgetUpdatedCount()).toBe(changesBefore);
    }, 60_000);
  });

  /**
   * The other half of the ADR-075 Class C (retired; ground now ADR-098)
   * split. The retired reactor touched
   * `VirtualKey.lastUsedAt` on every gateway trace (its "EC6" branch) because
   * `/budget/check` only fires when the gateway has budgets to precheck, so
   * keys without budgets read `lastUsedAt = null` forever and admin oversight
   * was broken on the most common case. That half is not derived state — a
   * replay stamping it would turn "when was this key last used" into "when did
   * an operator last run a replay" — so it is a subscriber, at-most-once, and
   * is driven here against the same real Postgres the debit half uses.
   */
  describe("when a gateway span lands for a key nothing has used", () => {
    it("stamps the key as used", async () => {
      const subscriber = createVirtualKeyLastUsedSubscriber({ prisma });
      const before = await prisma.virtualKey.findUnique({
        where: { id: VK_ID },
        select: { lastUsedAt: true },
      });
      // Load-bearing: every test above wrote debits for this key and the
      // column is still null, so the debit half really did stop carrying the
      // touch. The reactor did both in one handler.
      expect(before?.lastUsedAt).toBeNull();

      await subscriber.handle(
        gatewaySpanEvent({
          gatewayRequestId: `req-${suffix}-last-used`,
        }) as unknown as TraceProcessingEvent,
        { tenantId: PROJECT_ID, aggregateId: `trace-${suffix}` },
      );

      const after = await prisma.virtualKey.findUnique({
        where: { id: VK_ID },
        select: { lastUsedAt: true },
      });
      expect(after?.lastUsedAt).toBeInstanceOf(Date);
    }, 60_000);

    it("refuses to stamp a key belonging to another organization", async () => {
      const subscriber = createVirtualKeyLastUsedSubscriber({ prisma });

      await subscriber.handle(
        gatewaySpanEvent({
          gatewayRequestId: `req-${suffix}-last-used-cross`,
          virtualKeyId: OTHER_VK_ID,
        }) as unknown as TraceProcessingEvent,
        { tenantId: PROJECT_ID, aggregateId: `trace-${suffix}` },
      );

      const other = await prisma.virtualKey.findUnique({
        where: { id: OTHER_VK_ID },
        select: { lastUsedAt: true },
      });
      expect(other?.lastUsedAt).toBeNull();
    }, 60_000);
  });
});
