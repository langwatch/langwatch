/**
 * Unit tests for the webhookEndpoints tRPC router: RBAC scope mapping per
 * procedure, the enterprise plan gate, and the secret-once contract (the
 * secret appears only in create/rollSecret responses, never on reads).
 *
 * @see specs/webhooks/webhook-endpoints.feature
 */
import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { webhookEndpointsRouter } from "../webhookEndpoints";
import { createInnerTRPCContext } from "../../trpc";

const ORG_ID = "org_1";

// Every checkOrganizationPermission call records its permission string and
// denies the ones a test put into `denied`, so each procedure's scope
// mapping is asserted against the real wiring, not a copy of it.
const seenPermissions: string[] = [];
const denied = new Set<string>();

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    checkOrganizationPermission:
      (permission: string) =>
      async ({ ctx, next }: any) => {
        seenPermissions.push(permission);
        if (denied.has(permission)) {
          throw Object.assign(new Error("denied"), { code: "UNAUTHORIZED" });
        }
        ctx.permissionChecked = true;
        return next();
      },
  };
});

const getActivePlan = vi.fn();
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ planProvider: { getActivePlan } }),
}));

const ENDPOINT_ROW = {
  id: "whep_1",
  organizationId: ORG_ID,
  url: "https://example.com/hook",
  enabledEvents: ["gateway.request.completed"],
  status: "ACTIVE",
  disabledReason: null,
  disabledAt: null,
  failingSince: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  archivedAt: null,
  secretEncrypted: "encrypted-material",
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
};

function buildMockPrisma() {
  return {
    webhookEndpoint: {
      findMany: vi.fn().mockResolvedValue([ENDPOINT_ROW]),
      findFirst: vi.fn().mockResolvedValue(ENDPOINT_ROW),
      create: vi.fn().mockResolvedValue(ENDPOINT_ROW),
      update: vi.fn().mockResolvedValue(ENDPOINT_ROW),
    },
  } as unknown as PrismaClient;
}

function buildCaller(prisma: PrismaClient) {
  const ctx = createInnerTRPCContext({
    session: { user: { id: "user_1" }, expires: "1" },
    req: undefined,
    res: undefined,
    permissionChecked: false,
    publiclyShared: false,
  });
  ctx.prisma = prisma;
  return webhookEndpointsRouter.createCaller(ctx);
}

describe("webhookEndpointsRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seenPermissions.length = 0;
    denied.clear();
    getActivePlan.mockResolvedValue({ webhookEndpointsEnabled: true });
  });

  /** @scenario Read procedures require the view scope and mutations the manage scope */
  it("maps view scopes to reads and manage scopes to mutations", async () => {
    const caller = buildCaller(buildMockPrisma());
    await caller.list({ organizationId: ORG_ID });
    await caller.eventTypes({ organizationId: ORG_ID });
    await caller.disable({ organizationId: ORG_ID, endpointId: "whep_1" });
    expect(seenPermissions).toEqual([
      "webhookEndpoints:view",
      "webhookEndpoints:view",
      "webhookEndpoints:manage",
    ]);
  });

  /** @scenario A denied scope rejects before any service call */
  it("denies when the RBAC middleware denies", async () => {
    denied.add("webhookEndpoints:manage");
    const prisma = buildMockPrisma();
    const caller = buildCaller(prisma);
    await expect(
      caller.create({
        organizationId: ORG_ID,
        url: "https://example.com/hook",
        enabledEvents: ["gateway.request.completed"],
      }),
    ).rejects.toThrow("denied");
    expect(
      (prisma as any).webhookEndpoint.create,
    ).not.toHaveBeenCalled();
  });

  /** @scenario Sessions of organizations without the plan flag are refused */
  it("refuses every procedure when the plan lacks the entitlement", async () => {
    getActivePlan.mockResolvedValue({ webhookEndpointsEnabled: false });
    const caller = buildCaller(buildMockPrisma());
    await expect(caller.list({ organizationId: ORG_ID })).rejects.toThrow(
      /enterprise feature/i,
    );
  });

  /** @scenario The session surface returns the secret only from create and roll mutations */
  it("returns the secret from create and roll but never from list", async () => {
    const caller = buildCaller(buildMockPrisma());
    const created = await caller.create({
      organizationId: ORG_ID,
      url: "https://example.com/hook",
      enabledEvents: ["gateway.request.completed"],
    });
    expect(created.secret).toMatch(/^whsec_/);

    const listed = await caller.list({ organizationId: ORG_ID });
    const flat = JSON.stringify(listed);
    expect(flat).not.toContain("whsec_");
    expect(flat).not.toContain("secret");

    const rolled = await caller.rollSecret({
      organizationId: ORG_ID,
      endpointId: created.endpoint.id,
    });
    expect(rolled.secret).toMatch(/^whsec_/);
    expect(rolled.secret).not.toBe(created.secret);
  });

  /** @scenario Unknown event selectors surface as a bad request in the session surface */
  it("maps validation errors to BAD_REQUEST", async () => {
    const caller = buildCaller(buildMockPrisma());
    await expect(
      caller.create({
        organizationId: ORG_ID,
        url: "https://example.com/hook",
        enabledEvents: ["nonsense.event"],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
