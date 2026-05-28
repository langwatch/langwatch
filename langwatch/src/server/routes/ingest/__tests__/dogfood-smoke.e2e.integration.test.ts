/**
 * @vitest-environment node
 *
 * End-to-end customer dogfood smoke (Phase 5 cross-lane row).
 *
 * Mints a fresh customer (org + admin + IngestionSource), POSTs an OTel
 * trace through the public HTTP receiver, then verifies the full
 * dogfood narrative end-to-end:
 *
 *   1. Receiver auth + handoff: POST /api/ingest/otel/:sourceId with the
 *      bearer succeeds, handoff to handleOtlpTraceRequest fires with
 *      the hidden Governance Project as tenant + origin metadata
 *      stamped on every span.
 *   2. lastEventAt advances on Prisma — proves the receiver's
 *      recordEventReceived path runs (the dashboard-side composer-status
 *      flip awaiting→active downstream depends on this).
 *   3. tRPC dashboard query: orgA's admin sees the seeded source via
 *      ingestionSources.list (the receiver's source visibility from the
 *      caller's perspective).
 *   4. Layer-1 cross-org isolation: orgB's admin calling
 *      ingestionSources.list MUST NOT see orgA's source — proves the
 *      Prisma multitenancy middleware filters at the data layer (no
 *      reliance on the HTTP receiver's bearer mismatch alone).
 *
 * This complements the webhook cross-org auth-contract test
 * (fa1f304d3 — receiver-layer 401) with a data-layer isolation proof
 * via tRPC.
 *
 * Pairs with:
 *   - ingestionRoutes.integration.test.ts (auth/routing/handoff)
 *   - license-gate-governance.integration.test.ts (Sergey's f8eec569b
 *     — license + RBAC composition pattern; we reuse configureApp +
 *     createTestApp planProvider override here)
 *
 * Spec: specs/ai-gateway/governance/architecture-invariants.feature
 *       (cross-org isolation + receiver→dashboard round-trip)
 */
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { FREE_PLAN } from "../../../../../ee/licensing/constants";
import type { PlanInfo } from "../../../../../ee/licensing/planInfo";

import { prisma } from "~/server/db";
import { IngestionSourceService } from "@ee/governance/services/activity-monitor/ingestionSource.service";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { PlanProviderService } from "~/server/app-layer/subscription/plan-provider";

import { appRouter } from "~/server/api/root";
import { createInnerTRPCContext } from "~/server/api/trpc";

import { app as ingestApp } from "../ingestionRoutes";

const ns = `dogfood-${nanoid(8)}`;

const enterprisePlan: PlanInfo = { ...FREE_PLAN, type: "ENTERPRISE" };

interface SeededOrg {
  organizationId: string;
  teamId: string;
  adminUserId: string;
  ingestionSourceId: string;
  ingestSecret: string;
}

const handleTraceSpy = vi.fn(async (_tenantId: string, _request: unknown) => ({
  rejectedSpans: 0,
}));

vi.mock("~/server/app-layer/app", async () => {
  const actual = await vi.importActual<typeof import("~/server/app-layer/app")>(
    "~/server/app-layer/app",
  );
  return {
    ...actual,
    getApp: () => {
      const real =
        actual.globalForApp.__langwatch_app ??
        (() => {
          throw new Error("test app not configured — call configureApp first");
        })();
      // Swap traces.collection so the dogfood receiver path stays in-process
      // without forcing the full trace pipeline (CH writes, OTel ingest etc).
      // planProvider stays from the configured app so the license gate fires
      // naturally via Sergey's f8eec569b.
      return new Proxy(real, {
        get(target, prop) {
          if (prop === "traces") {
            return {
              collection: { handleOtlpTraceRequest: handleTraceSpy },
              logCollection: {
                handleOtlpLogRequest: vi.fn(async () => undefined),
              },
            };
          }
          return Reflect.get(target, prop);
        },
      }) as never;
    },
  };
});

function configureApp(plan: PlanInfo) {
  resetApp();
  globalForApp.__langwatch_app = createTestApp({
    planProvider: PlanProviderService.create({
      getActivePlan: async () => plan,
    }),
  });
}

async function seedOrg(suffix: string): Promise<SeededOrg> {
  const org = await prisma.organization.create({
    data: { name: `Dogfood ${suffix}`, slug: `--dogfood-${suffix}` },
  });
  const team = await prisma.team.create({
    data: {
      name: `Dogfood Team ${suffix}`,
      slug: `--dogfood-team-${suffix}`,
      organizationId: org.id,
    },
  });
  const admin = await prisma.user.create({
    data: { name: "Admin", email: `dogfood-admin-${suffix}@example.com` },
  });
  await prisma.organizationUser.create({
    data: {
      userId: admin.id,
      organizationId: org.id,
      role: OrganizationUserRole.ADMIN,
    },
  });
  await prisma.teamUser.create({
    data: { userId: admin.id, teamId: team.id, role: TeamUserRole.ADMIN },
  });
  await prisma.roleBinding.create({
    data: {
      organizationId: org.id,
      userId: admin.id,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: org.id,
    },
  });

  const service = IngestionSourceService.create(prisma);
  const { source, ingestSecret } = await service.createSource({
    organizationId: org.id,
    sourceType: "otel_generic",
    name: `Dogfood Source ${suffix}`,
    actorUserId: admin.id,
  });

  return {
    organizationId: org.id,
    teamId: team.id,
    adminUserId: admin.id,
    ingestionSourceId: source.id,
    ingestSecret,
  };
}

async function deleteSeededOrg(seed: SeededOrg | null): Promise<void> {
  if (!seed) return;
  await prisma.ingestionSource
    .delete({ where: { id: seed.ingestionSourceId } })
    .catch(() => {});
  await prisma.project
    .deleteMany({ where: { team: { organizationId: seed.organizationId } } })
    .catch(() => {});
  await prisma.roleBinding
    .deleteMany({ where: { organizationId: seed.organizationId } })
    .catch(() => {});
  await prisma.teamUser
    .deleteMany({ where: { team: { organizationId: seed.organizationId } } })
    .catch(() => {});
  await prisma.organizationUser
    .deleteMany({ where: { organizationId: seed.organizationId } })
    .catch(() => {});
  await prisma.team
    .deleteMany({ where: { organizationId: seed.organizationId } })
    .catch(() => {});
  await prisma.organization
    .delete({ where: { id: seed.organizationId } })
    .catch(() => {});
  await prisma.user
    .delete({ where: { id: seed.adminUserId } })
    .catch(() => {});
}

function buildOtlpJsonBody(): ArrayBuffer {
  const startNano = String(BigInt(Date.now()) * 1_000_000n);
  const endNano = String((BigInt(Date.now()) + 100n) * 1_000_000n);
  const payload = {
    resourceSpans: [
      {
        resource: { attributes: [] },
        scopeSpans: [
          {
            scope: { name: "dogfood-test", version: "1.0" },
            spans: [
              {
                traceId: "0".repeat(31) + "1",
                spanId: "0".repeat(15) + "1",
                name: "dogfood-canary-span",
                kind: 1,
                startTimeUnixNano: startNano,
                endTimeUnixNano: endNano,
                attributes: [],
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

function callerFor(userId: string) {
  const ctx = createInnerTRPCContext({
    session: { user: { id: userId }, expires: "1" } as any,
  });
  return appRouter.createCaller(ctx);
}

describe("end-to-end customer dogfood smoke (Phase 5 cross-lane)", () => {
  let orgA: SeededOrg | null = null;
  let orgB: SeededOrg | null = null;

  beforeAll(async () => {
    configureApp(enterprisePlan);
    const suffixA = nanoid(8);
    const suffixB = nanoid(8);
    orgA = await seedOrg(`a-${ns}-${suffixA}`);
    orgB = await seedOrg(`b-${ns}-${suffixB}`);
  });

  afterAll(async () => {
    await deleteSeededOrg(orgA);
    await deleteSeededOrg(orgB);
    resetApp();
  });

  it("receiver: bearer for orgA hands the trace off to the gov-project pipeline", async () => {
    handleTraceSpy.mockClear();
    const res = await ingestApp.request(
      `/api/ingest/otel/${orgA!.ingestionSourceId}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${orgA!.ingestSecret}`,
        },
        body: buildOtlpJsonBody(),
      },
    );
    expect(res.status).toBe(202);
    expect(handleTraceSpy).toHaveBeenCalledTimes(1);
    const [tenantId, request] = handleTraceSpy.mock.calls[0]!;
    // Tenant is the hidden Governance Project, not the user-facing one.
    expect(typeof tenantId).toBe("string");
    expect(tenantId).not.toBe(orgA!.organizationId);
    // Origin metadata stamped on the span attributes.
    const spans = (request as any).resourceSpans?.[0]?.scopeSpans?.[0]?.spans;
    const attrKeys = (spans?.[0]?.attributes ?? []).map((a: any) => a.key);
    expect(attrKeys).toContain("langwatch.origin.kind");
    expect(attrKeys).toContain("langwatch.ingestion_source.id");
    expect(attrKeys).toContain("langwatch.ingestion_source.organization_id");
  });

  it("receiver: lastEventAt advances on Prisma after a successful post (composer awaiting → active)", async () => {
    const before = await prisma.ingestionSource.findUnique({
      where: { id: orgA!.ingestionSourceId },
      select: { lastEventAt: true },
    });
    handleTraceSpy.mockClear();
    await ingestApp.request(`/api/ingest/otel/${orgA!.ingestionSourceId}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${orgA!.ingestSecret}`,
      },
      body: buildOtlpJsonBody(),
    });
    const after = await prisma.ingestionSource.findUnique({
      where: { id: orgA!.ingestionSourceId },
      select: { lastEventAt: true },
    });
    expect(after?.lastEventAt).toBeTruthy();
    if (before?.lastEventAt && after?.lastEventAt) {
      expect(after.lastEventAt.getTime()).toBeGreaterThanOrEqual(
        before.lastEventAt.getTime(),
      );
    }
  });

  it("dashboard: orgA's admin sees orgA's source via ingestionSources.list", async () => {
    const result = await callerFor(orgA!.adminUserId).ingestionSources.list({
      organizationId: orgA!.organizationId,
    });
    const sourceIds = result.map((s: { id: string }) => s.id);
    expect(sourceIds).toContain(orgA!.ingestionSourceId);
  });

  it("Layer-1 cross-org isolation: orgB's admin does NOT see orgA's source via ingestionSources.list", async () => {
    const result = await callerFor(orgB!.adminUserId).ingestionSources.list({
      organizationId: orgB!.organizationId,
    });
    const sourceIds = result.map((s: { id: string }) => s.id);
    expect(sourceIds).not.toContain(orgA!.ingestionSourceId);
    // Sanity: orgB's own source is visible (proves the query works).
    expect(sourceIds).toContain(orgB!.ingestionSourceId);
  });

  it("Layer-1 cross-org isolation: orgB's admin requesting orgA's organizationId is rejected by the multitenancy middleware", async () => {
    await expect(
      callerFor(orgB!.adminUserId).ingestionSources.list({
        organizationId: orgA!.organizationId,
      }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|UNAUTHORIZED/) });
  });
});
