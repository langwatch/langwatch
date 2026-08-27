/**
 * @vitest-environment node
 *
 * End-to-end customer dogfood smoke. It seeds an org, admin and ingestion
 * source, posts an OTel trace, and proves receiver handoff/origin metadata
 * plus `lastEventAt` persistence.
 *
 * It also proves the dashboard can list that source for the owning admin but
 * not for another org's admin. That is the data-layer isolation assertion;
 * receiver bearer rejection is covered separately.
 *
 * See `architecture-invariants.feature` for the receiver-to-dashboard path.
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { appRouter } from "~/server/api/root";
import { createInnerTRPCContext } from "~/server/api/trpc";
import type { App } from "~/server/app-layer/app";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { PlanProviderService } from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import { FREE_PLAN } from "@langwatch/enterprise-licensing-contract";
import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";

import { app as ingestApp } from "../ingestionRoutes";

const ns = `dogfood-${nanoid(8)}`;

const enterprisePlan: PlanInfo = { ...FREE_PLAN, type: "ENTERPRISE" };
let testApp: App;

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

async function configureApp(plan: PlanInfo) {
  await resetApp();
  testApp = createTestApp({
    planProvider: PlanProviderService.create({
      getActivePlan: async () => plan,
    }),
  });
  globalForApp.__langwatch_app = testApp;
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

  const { source, ingestSecret } = await testApp.governance.ingestionSourceCreate({
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
  await prisma.user.delete({ where: { id: seed.adminUserId } }).catch(() => {});
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
  return new TextEncoder().encode(JSON.stringify(payload)).buffer as ArrayBuffer;
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
    await configureApp(enterprisePlan);
    const suffixA = nanoid(8);
    const suffixB = nanoid(8);
    orgA = await seedOrg(`a-${ns}-${suffixA}`);
    orgB = await seedOrg(`b-${ns}-${suffixB}`);
  });

  afterAll(async () => {
    await deleteSeededOrg(orgA);
    await deleteSeededOrg(orgB);
    await resetApp();
  });

  it("receiver: bearer for orgA hands the trace off to the gov-project pipeline", async () => {
    handleTraceSpy.mockClear();
    const res = await ingestApp.request(`/api/ingest/otel/${orgA!.ingestionSourceId}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${orgA!.ingestSecret}`,
      },
      body: buildOtlpJsonBody(),
    });
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
    ).rejects.toMatchObject({
      code: expect.stringMatching(/FORBIDDEN|UNAUTHORIZED/),
    });
  });
});
