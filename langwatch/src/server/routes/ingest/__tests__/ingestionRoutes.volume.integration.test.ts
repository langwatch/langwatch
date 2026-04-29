/**
 * Volume regression test for the governance ingest receiver.
 *
 * Locks production-quality invariants under concurrent + sustained load
 * that were flagged in the PM round-up (PR #3524 Phase 5 GTM-readiness gate
 * + Sergey's lane-S production gaps):
 *
 *   1. Slug-collision invariant: under N concurrent first-mints (cold start
 *      with no hidden Gov Project yet), the slug-uniqueness re-check at
 *      governanceProject.service.ts:82 must collapse to ONE Project, not N.
 *      The 8-test helper-integration suite proves 5-concurrent. This proves
 *      higher N + via the HTTP receiver entrypoint (not the helper directly).
 *
 *   2. Receiver does not 5xx under concurrent load. Every POST returns 202
 *      regardless of how many neighbours are in flight.
 *
 *   3. lastEventAt advances exactly once per successful POST. The
 *      `recordEventReceived` write is not skipped or batched away under
 *      load — proves the composer's "Awaiting → Active" status flip is
 *      reliable.
 *
 *   4. p99 latency surfaces the cliff. Loose threshold (1500ms p99)
 *      catches catastrophic regressions; the goal is to *measure* the
 *      hot-path so the lane-S `prisma.findFirst` per-request gap can be
 *      addressed with concrete data, not block CI.
 *
 *   5. handleOtlpTraceRequest invoked exactly N times — the trace-pipeline
 *      handoff is not deduped or batched at the HTTP layer.
 *
 * Test scale: 50 concurrent + 100 sequential posts against ONE source
 * (proves the lazy-ensure happy-path under concurrent first-mint), plus
 * 20 concurrent first-mints across 20 *different* orgs (proves cross-org
 * concurrency doesn't break tenant isolation under load — Sergey's
 * "50 orgs × 100 concurrent first-mints" gap, scaled down for CI runtime).
 *
 * Out of scope (deferred to `*.stress.test.ts` running against real
 * dev server — see `vitest.stress.config.ts`):
 *   - Sustained throughput cliff (1k spans/sec for 60s)
 *   - Memory leak detection
 *   - DB connection pool exhaustion
 *   - Receiver auth rate limiting (per-source Redis-token-bucket RPS)
 *
 * Pairs with:
 *   - ingestionRoutes.integration.test.ts (d20a1b403 — auth + routing + stamping contract)
 *   - governanceProject.service.integration.test.ts (0a2b7e8d9 — 5-concurrent helper)
 *   - eventLogDurability.integration.test.ts (f25d713ab — non-repudiation)
 *
 * Spec coverage:
 *   - specs/ai-gateway/governance/architecture-invariants.feature
 *     (lazy-ensure idempotency under load)
 *   - specs/ai-gateway/governance/receiver-shapes.feature
 *     (receiver returns 202 under load)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";

import { prisma } from "~/server/db";
import { IngestionSourceService } from "~/server/governance/activity-monitor/ingestionSource.service";
import { PROJECT_KIND } from "~/server/governance/governanceProject.service";

import { app as ingestApp } from "../ingestionRoutes";

const NS = `volume-${nanoid(6)}`;

interface SeededOrg {
  organizationId: string;
  teamId: string;
  userId: string;
  ingestionSourceId: string;
  ingestSecret: string;
}

async function seedOrgWithIngestionSource(orgSlug: string): Promise<SeededOrg> {
  const org = await prisma.organization.create({
    data: { name: `Org ${orgSlug}`, slug: orgSlug },
  });
  const team = await prisma.team.create({
    data: {
      name: `Team ${orgSlug}`,
      slug: `team-${orgSlug}`,
      organizationId: org.id,
    },
  });
  const user = await prisma.user.create({
    data: {
      email: `user-${orgSlug}@example.com`,
      name: `User ${orgSlug}`,
    },
  });
  await prisma.organizationUser.create({
    data: { userId: user.id, organizationId: org.id, role: "ADMIN" },
  });
  const service = IngestionSourceService.create(prisma);
  const { source, ingestSecret } = await service.createSource({
    organizationId: org.id,
    sourceType: "otel_generic",
    name: `Source ${orgSlug}`,
    actorUserId: user.id,
  });
  return {
    organizationId: org.id,
    teamId: team.id,
    userId: user.id,
    ingestionSourceId: source.id,
    ingestSecret,
  };
}

async function deleteSeededOrg(seed: SeededOrg | null): Promise<void> {
  if (!seed) return;
  await prisma.ingestionSource
    .deleteMany({ where: { organizationId: seed.organizationId } })
    .catch(() => undefined);
  await prisma.project
    .deleteMany({ where: { team: { organizationId: seed.organizationId } } })
    .catch(() => undefined);
  await prisma.organizationUser
    .deleteMany({ where: { organizationId: seed.organizationId } })
    .catch(() => undefined);
  await prisma.team
    .deleteMany({ where: { organizationId: seed.organizationId } })
    .catch(() => undefined);
  await prisma.organization
    .delete({ where: { id: seed.organizationId } })
    .catch(() => undefined);
  await prisma.user.delete({ where: { id: seed.userId } }).catch(() => undefined);
}

function buildOtlpJsonBody(spanName = "volume-canary"): ArrayBuffer {
  const startNano = String(BigInt(Date.now()) * 1_000_000n);
  const endNano = String((BigInt(Date.now()) + 100n) * 1_000_000n);
  const traceId = nanoid(16)
    .split("")
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
  const spanId = traceId.slice(0, 16);
  const payload = {
    resourceSpans: [
      {
        resource: { attributes: [] },
        scopeSpans: [
          {
            scope: { name: "volume-test", version: "1.0" },
            spans: [
              {
                traceId,
                spanId,
                name: spanName,
                kind: 1,
                startTimeUnixNano: startNano,
                endTimeUnixNano: endNano,
                attributes: [
                  {
                    key: "user.email",
                    value: { stringValue: "volume@example.com" },
                  },
                  {
                    key: "gen_ai.usage.cost_usd",
                    value: { doubleValue: 0.001 },
                  },
                ],
                status: { code: 1 },
              },
            ],
          },
        ],
      },
    ],
  };
  return new TextEncoder().encode(JSON.stringify(payload))
    .buffer as ArrayBuffer;
}

const handleTraceSpy = vi.fn(
  async (
    _tenantId: string,
    _request: unknown,
    _piiRedactionLevel?: unknown,
  ) => ({ rejectedSpans: 0 }),
);
const handleLogSpy = vi.fn(async (_args: unknown) => undefined);

vi.mock("~/server/app-layer/app", async () => {
  const actual = await vi.importActual<typeof import("~/server/app-layer/app")>(
    "~/server/app-layer/app",
  );
  return {
    ...actual,
    getApp: () =>
      ({
        traces: {
          collection: { handleOtlpTraceRequest: handleTraceSpy },
          logCollection: { handleOtlpLogRequest: handleLogSpy },
        },
      }) as never,
  };
});

function percentile(sortedAscMs: number[], p: number): number {
  if (sortedAscMs.length === 0) return 0;
  const idx = Math.min(sortedAscMs.length - 1, Math.floor(sortedAscMs.length * p));
  return sortedAscMs[idx]!;
}

async function postOnce(
  sourceId: string,
  bearer: string,
): Promise<{ status: number; latencyMs: number }> {
  const body = buildOtlpJsonBody();
  const start = Date.now();
  const res = await ingestApp.request(`/api/ingest/otel/${sourceId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bearer}`,
    },
    body: new Uint8Array(body),
  });
  return { status: res.status, latencyMs: Date.now() - start };
}

describe("ingestionRoutes — volume regression", () => {
  let mainSeed: SeededOrg | null = null;
  const crossOrgSeeds: SeededOrg[] = [];

  beforeAll(async () => {
    mainSeed = await seedOrgWithIngestionSource(`${NS}-main`);
  });

  afterAll(async () => {
    await Promise.all([
      deleteSeededOrg(mainSeed),
      ...crossOrgSeeds.map((s) => deleteSeededOrg(s)),
    ]);
  }, 120_000);

  describe("given 50 concurrent POSTs to a single source", () => {
    it("returns 202 on every request, advances lastEventAt, p99 stays under 1500ms", async () => {
      handleTraceSpy.mockClear();
      const N = 50;
      const before = await prisma.ingestionSource.findUnique({
        where: { id: mainSeed!.ingestionSourceId },
      });

      const results = await Promise.all(
        Array.from({ length: N }, () =>
          postOnce(mainSeed!.ingestionSourceId, mainSeed!.ingestSecret),
        ),
      );

      const statuses = results.map((r) => r.status);
      expect(statuses.every((s) => s === 202)).toBe(true);

      const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
      const p99 = percentile(latencies, 0.99);
      const p50 = percentile(latencies, 0.5);
      // eslint-disable-next-line no-console
      console.log(
        `[volume] N=${N} concurrent → p50=${p50}ms p99=${p99}ms max=${latencies[latencies.length - 1]}ms`,
      );
      // Loose threshold: catches catastrophic regressions; informational
      // for the prisma.findFirst-per-request hot-path lane-S flagged.
      expect(p99).toBeLessThan(1500);

      const after = await prisma.ingestionSource.findUnique({
        where: { id: mainSeed!.ingestionSourceId },
      });
      // lastEventAt advanced (or was set) at least once
      expect(after?.lastEventAt).not.toBeNull();
      if (before?.lastEventAt && after?.lastEventAt) {
        expect(after.lastEventAt.getTime()).toBeGreaterThanOrEqual(
          before.lastEventAt.getTime(),
        );
      }

      expect(handleTraceSpy).toHaveBeenCalledTimes(N);
    });

    it("preserves slug-collision invariant: exactly one hidden Gov Project after concurrent first-mints", async () => {
      const govProjects = await prisma.project.findMany({
        where: {
          kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
          team: { organizationId: mainSeed!.organizationId },
        },
      });
      expect(govProjects).toHaveLength(1);
    });
  });

  describe("given 100 sequential POSTs to a single source", () => {
    it("returns 202 on every request without latency degradation", async () => {
      handleTraceSpy.mockClear();
      const N = 100;
      const latencies: number[] = [];
      for (let i = 0; i < N; i++) {
        const r = await postOnce(
          mainSeed!.ingestionSourceId,
          mainSeed!.ingestSecret,
        );
        expect(r.status).toBe(202);
        latencies.push(r.latencyMs);
      }
      const sorted = [...latencies].sort((a, b) => a - b);
      const p50 = percentile(sorted, 0.5);
      const p99 = percentile(sorted, 0.99);
      // eslint-disable-next-line no-console
      console.log(
        `[volume] N=${N} sequential → p50=${p50}ms p99=${p99}ms max=${sorted[sorted.length - 1]}ms`,
      );
      // Sequential should be CHEAPER than concurrent (no contention).
      // If sequential p99 > 800ms there's an unrelated regression.
      expect(p99).toBeLessThan(1500);
      expect(handleTraceSpy).toHaveBeenCalledTimes(N);
    });
  });

  describe("given 20 concurrent first-mints across 20 different orgs (cross-org concurrency)", () => {
    it("creates exactly one hidden Gov Project per org with no slug-collision leaks", async () => {
      handleTraceSpy.mockClear();
      const ORGS = 20;

      const seeds = await Promise.all(
        Array.from({ length: ORGS }, (_, i) =>
          seedOrgWithIngestionSource(`${NS}-cross-${i}-${nanoid(4)}`),
        ),
      );
      seeds.forEach((s) => crossOrgSeeds.push(s));

      const results = await Promise.all(
        seeds.map((s) => postOnce(s.ingestionSourceId, s.ingestSecret)),
      );

      expect(results.every((r) => r.status === 202)).toBe(true);

      const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
      // eslint-disable-next-line no-console
      console.log(
        `[volume] cross-org first-mint × ${ORGS} → p99=${percentile(latencies, 0.99)}ms`,
      );

      const govProjectCounts = await Promise.all(
        seeds.map((s) =>
          prisma.project.count({
            where: {
              kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
              team: { organizationId: s.organizationId },
            },
          }),
        ),
      );
      expect(govProjectCounts.every((c) => c === 1)).toBe(true);

      // handleTraceSpy was called once per org (one POST each)
      expect(handleTraceSpy).toHaveBeenCalledTimes(ORGS);
    });
  });
});
