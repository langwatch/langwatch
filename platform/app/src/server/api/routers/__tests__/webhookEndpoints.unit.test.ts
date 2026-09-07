/**
 * Unit tests for the webhookEndpoints tRPC router: RBAC scope mapping per
 * procedure, the enterprise plan gate, and the secret-once contract (the
 * secret appears only in create/rollSecret responses, never on reads).
 *
 * @see specs/webhooks/webhook-endpoints.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { createInnerTRPCContext } from "../../trpc";
import { webhookEndpointsRouter } from "../webhookEndpoints";

const ORG_ID = "org_1";

// protectedProcedure audits every mutation and every handled error through
// the module-level Prisma client, which no injected ctx.prisma can stand in
// for. Stubbed so the router's own behaviour is what these assertions see.
//
// The specifier has to be the one `trpc.ts` imports. A relative path that
// resolves to no module mocks nothing and throws nothing: the real audit
// log then runs, and this file passes anywhere a Postgres happens to be
// listening on 5432 while failing in CI, where none is.
vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

// Secret material at rest is AES-GCM under the deployment's
// CREDENTIALS_SECRET. What the secret-once contract needs is that the
// plaintext reaches create and rollSecret and no read path, so the cipher
// stands in as an identity pair and the assertions hold anywhere.
vi.mock("~/utils/encryption", () => ({
  encrypt: (value: string) => `encrypted:${value}`,
  decrypt: (value: string) => value.replace(/^encrypted:/, ""),
}));

// Every checkOrganizationPermission call records its permission string and
// denies the ones a test put into `denied`, so each procedure's scope
// mapping is asserted against the real wiring, not a copy of it.
const seenPermissions: string[] = [];
const denied = new Set<string>();

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    hasOrganizationPermission: vi.fn(
      async (_ctx: unknown, _organizationId: string, permission: string) => {
        seenPermissions.push(permission);
        return !denied.has(permission);
      },
    ),
  };
});

const getActivePlan = vi.fn();
vi.mock("~/server/app-layer/app", async () => {
  const { appPermissionsService } = await import(
    "~/test-utils/appPermissionsMock"
  );
  return {
    // Consumers that degrade without Redis read through this one.
    tryGetApp: () => null,
    getApp: () => ({
      permissions: appPermissionsService(),
      planProvider: { getActivePlan },
    }),
  };
});

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
    // Not a suite about the second-factor gate. Without this the gate runs
    // inside the permission middleware, reads the scope's owner from a Prisma
    // double that has only this router's models, and fails there instead of
    // here — and only where the deployment switches it on.
    mfaGate: { offered: () => false },
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
    ).rejects.toThrow("You do not have permission");
    expect((prisma as any).webhookEndpoint.create).not.toHaveBeenCalled();
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
