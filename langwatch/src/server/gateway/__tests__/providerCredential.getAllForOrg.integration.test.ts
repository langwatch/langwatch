/**
 * @vitest-environment node
 *
 * G86 diagnostic — when a provider credential is bound at PROJECT scope
 * (the only path the gateway-providers admin offers), can the
 * org-scoped routing-policy drawer see it via `getAllForOrg`?
 *
 * Reproduces Ariana's exact path:
 *   1. Bootstrap an org (mirrors createAndAssign): Org + Team + Project
 *   2. Create a ModelProvider under that project
 *   3. Bind a GatewayProviderCredential to that ModelProvider
 *   4. Call `getAllForOrg(organizationId)` — assert 1 row returned
 *
 * If this test green-passes, the bug is environmental (UI passing the
 * wrong organizationId, stale localStorage, etc.) — not a service-layer
 * scope mismatch. If it fails, we found the real visibility gap.
 *
 * Hits real PG (testcontainers) — NO MOCKS.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";

import { GatewayProviderCredentialService } from "../providerCredential.service";

const suffix = nanoid(8);
const ORG_ID = `org-g86-${suffix}`;
const TEAM_ID = `team-g86-${suffix}`;
const PROJECT_ID = `proj-g86-${suffix}`;
const USER_ID = `usr-g86-${suffix}`;
const MP_ID = `mp-g86-${suffix}`;

describe("G86 diagnostic — getAllForOrg sees project-scoped binds", () => {
  const service = GatewayProviderCredentialService.create(prisma);

  beforeAll(async () => {
    await startTestContainers();

    // Mirror createAndAssign's bootstrap shape — Org + Team + Project +
    // OrganizationUser + RoleBindings — minus the parts not relevant to
    // the visibility check (RoleBindings/OrganizationUser not needed
    // since the service-layer test bypasses RBAC; we only care about
    // the storage / query contract).
    await prisma.organization.create({
      data: {
        id: ORG_ID,
        name: `G86 Org ${suffix}`,
        slug: `g86-${suffix}`,
      },
    });
    await prisma.user.create({
      data: {
        id: USER_ID,
        email: `g86-${suffix}@example.com`,
        name: "G86 Owner",
      },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `G86 Team ${suffix}`,
        slug: `g86-team-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: `G86 Project ${suffix}`,
        slug: `g86-proj-${suffix}`,
        apiKey: `key-${suffix}`,
        teamId: TEAM_ID,
        language: "typescript",
        framework: "openai",
      },
    });
    // ModelProvider must exist + be enabled before a credential can
    // bind to it (matches the service.create guard in
    // providerCredential.service.ts).
    await prisma.modelProvider.create({
      data: {
        id: MP_ID,
        projectId: PROJECT_ID,
        name: "Anthropic",
        provider: "anthropic",
        enabled: true,
      },
    });
  });

  afterAll(async () => {
    await prisma.gatewayProviderCredential
      .deleteMany({ where: { projectId: PROJECT_ID } })
      .catch(() => undefined);
    await prisma.modelProvider
      .deleteMany({ where: { projectId: PROJECT_ID } })
      .catch(() => undefined);
    await prisma.project
      .deleteMany({ where: { id: PROJECT_ID } })
      .catch(() => undefined);
    await prisma.team
      .deleteMany({ where: { organizationId: ORG_ID } })
      .catch(() => undefined);
    await prisma.user
      .deleteMany({ where: { id: USER_ID } })
      .catch(() => undefined);
    await prisma.organization
      .deleteMany({ where: { id: ORG_ID } })
      .catch(() => undefined);
    await stopTestContainers().catch(() => undefined);
  });

  it("getAllForOrg returns a project-scoped credential bind", async () => {
    // Step 1: bind a credential the way the gateway-providers admin
    // does. Goes through service.create which writes
    // gatewayProviderCredential.projectId = PROJECT_ID.
    const created = await service.create({
      projectId: PROJECT_ID,
      organizationId: ORG_ID,
      modelProviderId: MP_ID,
      slot: "primary",
      actorUserId: USER_ID,
    });
    expect(created.id).toBeTruthy();
    expect(created.projectId).toBe(PROJECT_ID);

    // Step 2: org-scoped query the routing-policy drawer issues. If
    // this returns [] we have a real bug; if it returns the bind
    // we just made, the bug is environmental in Ariana's session.
    const orgRows = await service.getAllForOrg(ORG_ID);
    expect(orgRows.length).toBeGreaterThanOrEqual(1);
    const found = orgRows.find((r) => r.id === created.id);
    expect(found).toBeDefined();
    expect(found?.projectId).toBe(PROJECT_ID);
    expect(found?.modelProviderId).toBe(MP_ID);
  });

  it("disableAllForModelProvider cascades disabledAt to dependent bindings (G88/G89 follow-up)", async () => {
    // Seed two binds against the same MP — G88 admin-disable cascade
    // must flip both. The first bind is reused from the previous test
    // already in `disabledAt: null` state; create a second so the
    // updateMany branch is exercised with > 1 row.
    const second = await service.create({
      projectId: PROJECT_ID,
      organizationId: ORG_ID,
      modelProviderId: MP_ID,
      slot: "secondary",
      actorUserId: USER_ID,
    });

    const before = await service.getAllForOrg(ORG_ID);
    const beforeDisabledCount = before.filter(
      (r) => r.disabledAt !== null,
    ).length;

    const flipped = await service.disableAllForModelProvider({
      modelProviderId: MP_ID,
      projectId: PROJECT_ID,
      organizationId: ORG_ID,
      actorUserId: USER_ID,
    });
    expect(flipped).toBeGreaterThanOrEqual(1);

    const after = await service.getAllForOrg(ORG_ID);
    const afterDisabledCount = after.filter(
      (r) => r.disabledAt !== null,
    ).length;
    // Every bind that was previously enabled should now be disabled.
    expect(afterDisabledCount).toBe(before.length);
    // And the count should have actually moved (otherwise the cascade
    // didn't do its job).
    expect(afterDisabledCount).toBeGreaterThan(beforeDisabledCount);

    // Idempotent — second call flips zero rows because all are already
    // disabled.
    const flippedAgain = await service.disableAllForModelProvider({
      modelProviderId: MP_ID,
      projectId: PROJECT_ID,
      organizationId: ORG_ID,
      actorUserId: USER_ID,
    });
    expect(flippedAgain).toBe(0);

    void second; // silence unused-binding lint
  });

  it("create transparently revives a disabled binding at the same slot (G115)", async () => {
    // After the cascade test the (PROJECT_ID, MP_ID, "primary") tuple is
    // held by a row with disabledAt != null. The unique constraint is
    // independent of disabledAt, so a naive INSERT would P2002 → 500.
    // Service contract: detect the disabled-row conflict and revive it
    // in place with the new settings.
    const before = await prisma.gatewayProviderCredential.findUnique({
      where: {
        projectId_modelProviderId_slot: {
          projectId: PROJECT_ID,
          modelProviderId: MP_ID,
          slot: "primary",
        },
      },
    });
    expect(before).not.toBeNull();
    expect(before?.disabledAt).not.toBeNull();
    const beforeId = before!.id;

    const revived = await service.create({
      projectId: PROJECT_ID,
      organizationId: ORG_ID,
      modelProviderId: MP_ID,
      slot: "primary",
      rateLimitRpm: 4242,
      actorUserId: USER_ID,
    });

    // Same id — proves we revived in place, did not insert a fresh row.
    expect(revived.id).toBe(beforeId);
    expect(revived.disabledAt).toBeNull();
    // Settings on the call propagate (covers the "user expects a fresh
    // bind" half of the mental model).
    expect(revived.rateLimitRpm).toBe(4242);

    // A second create against the now-active row must throw CONFLICT,
    // not P2002 — caller (UI) gets a typed tRPC error to react to.
    await expect(
      service.create({
        projectId: PROJECT_ID,
        organizationId: ORG_ID,
        modelProviderId: MP_ID,
        slot: "primary",
        actorUserId: USER_ID,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("getAllForOrg returns empty array for an org with no credentials", async () => {
    // Sanity check — distinct fresh org with no binds returns [],
    // not a leak from the parent test's seeded credential.
    const otherOrgId = `org-g86-other-${nanoid(6)}`;
    await prisma.organization.create({
      data: {
        id: otherOrgId,
        name: `G86 Other ${suffix}`,
        slug: `g86-other-${suffix}-${nanoid(6)}`,
      },
    });
    try {
      const rows = await service.getAllForOrg(otherOrgId);
      expect(rows).toEqual([]);
    } finally {
      await prisma.organization
        .delete({ where: { id: otherOrgId } })
        .catch(() => undefined);
    }
  });
});
