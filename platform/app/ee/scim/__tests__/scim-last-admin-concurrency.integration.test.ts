// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Two SCIM deactivations of the last two administrators must serialize the
 * active-admin decision. The second request waits on the organization lock,
 * then refuses before its grants are revoked.
 */
import {
  AuthzCollectorService,
  type GrantActor,
  GrantsService,
  type GrantsServiceDeps,
} from "@langwatch/authz-server";
import { generate } from "@langwatch/ksuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  GrantPrincipalType,
  GrantScopeType,
  OrganizationUserRole,
} from "~/generated/prisma/client";
import { bumpAuthzEpoch } from "~/server/app-layer/authz/epoch";
import { grantsLedgerWriter } from "~/server/app-layer/authz/ledger";
import { LedgerAuthzGrantsRepository } from "~/server/app-layer/authz/repositories/authz-grants.ledger.repository";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { KSUID_RESOURCES } from "~/utils/constants";
import { ScimService } from "../scim.service";
import type { ScimCreateUserRequest } from "../scim.types";

vi.mock("~/env.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/env.mjs")>();
  return { ...actual, env: { ...actual.env, SCIM_V2_GRANTS: "on" } };
});

wireDefaultTestApp();

const namespace = `scim-last-admin-${generate(KSUID_RESOURCES.ORGANIZATION).toString()}`;
const organizationId = `${namespace}-org`;
const firstAdminId = `${namespace}-first`;
const secondAdminId = `${namespace}-second`;

class TwoCallBarrier {
  private arrived = 0;
  private release: (() => void) | undefined;
  private readonly released = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  async wait(): Promise<void> {
    this.arrived += 1;
    if (this.arrived === 2) this.release?.();
    await this.released;
  }
}

class BarrierGrantsService extends GrantsService {
  constructor(
    repository: LedgerAuthzGrantsRepository,
    deps: GrantsServiceDeps,
    private readonly barrier: TwoCallBarrier,
  ) {
    super(repository, deps);
  }

  override async offboard({
    actor,
    userId,
    organizationId,
  }: {
    actor: GrantActor;
    userId: string;
    organizationId: string;
  }) {
    await this.barrier.wait();
    return super.offboard({ actor, userId, organizationId });
  }
}

function grantsService(barrier?: TwoCallBarrier): GrantsService {
  const writer = grantsLedgerWriter();
  const repository = new LedgerAuthzGrantsRepository(prisma, writer);
  const deps: GrantsServiceDeps = {
    newBindingId: () => generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
    bumpEpoch: bumpAuthzEpoch,
    collectorFor: (reader) => new AuthzCollectorService(reader),
  };
  return barrier
    ? new BarrierGrantsService(repository, deps, barrier)
    : new GrantsService(repository, deps);
}

const deactivation = (email: string): ScimCreateUserRequest => ({
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
  userName: email,
  active: false,
});

describe("SCIM last-admin deactivation concurrency", () => {
  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: organizationId, name: namespace, slug: namespace },
    });
    await prisma.user.createMany({
      data: [
        {
          id: firstAdminId,
          email: `${namespace}-first@example.com`,
          name: "First Admin",
        },
        {
          id: secondAdminId,
          email: `${namespace}-second@example.com`,
          name: "Second Admin",
        },
      ],
    });
    await prisma.organizationUser.createMany({
      data: [
        {
          userId: firstAdminId,
          organizationId,
          role: OrganizationUserRole.ADMIN,
        },
        {
          userId: secondAdminId,
          organizationId,
          role: OrganizationUserRole.ADMIN,
        },
      ],
    });
    await prisma.grant.createMany({
      data: [firstAdminId, secondAdminId].map((userId) => ({
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId,
        principalType: GrantPrincipalType.USER,
        principalId: userId,
        roleKey: "admin",
        source: "migration",
        scopeType: GrantScopeType.ORGANIZATION,
        scopeId: organizationId,
        occurredAt: new Date(),
      })),
    });
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["grant", { organizationId }],
      ["organizationUser", { organizationId }],
      ["user", { id: { in: [firstAdminId, secondAdminId] } }],
      ["organization", { id: organizationId }],
    ]);
  });

  it("rejects one contender before revoking that admin's grants", async () => {
    const barrier = new TwoCallBarrier();
    const service = ScimService.create({
      prisma,
      grants: grantsService(barrier),
    });
    const requests = [
      { id: firstAdminId, email: `${namespace}-first@example.com` },
      { id: secondAdminId, email: `${namespace}-second@example.com` },
    ];

    const outcomes = await Promise.allSettled(
      requests.map(({ id, email }) =>
        service.replaceUser({
          id,
          organizationId,
          request: deactivation(email),
        }),
      ),
    );

    const refused = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === "rejected",
    );
    expect(refused).toHaveLength(1);
    expect(refused[0]?.reason).toMatchObject({
      code: "cannot_disable_last_admin",
    });

    const remainingAdmins = await prisma.organizationUser.count({
      where: {
        organizationId,
        role: OrganizationUserRole.ADMIN,
        disabledAt: null,
        user: { deactivatedAt: null },
      },
    });
    expect(remainingAdmins).toBe(1);

    const refusedIndex = outcomes.findIndex(
      (outcome) => outcome.status === "rejected",
    );
    const refusedUserId = requests[refusedIndex]?.id;
    expect(refusedUserId).toBeDefined();
    const refusedGrants = await prisma.grant.count({
      where: {
        organizationId,
        principalType: GrantPrincipalType.USER,
        principalId: refusedUserId,
        revokedAt: null,
      },
    });
    expect(refusedGrants).toBe(1);
  });

  it("rejects deleting the only remaining administrator", async () => {
    const remainingAdmin = await prisma.organizationUser.findFirst({
      where: {
        organizationId,
        role: OrganizationUserRole.ADMIN,
        disabledAt: null,
      },
      select: { userId: true },
    });
    if (!remainingAdmin) {
      throw new Error("concurrency setup removed both administrators");
    }
    const remainingAdminId = remainingAdmin.userId;

    const service = ScimService.create({
      prisma,
      grants: grantsService(),
    });

    await expect(
      service.deleteUser({ id: remainingAdminId, organizationId }),
    ).rejects.toMatchObject({ code: "cannot_remove_last_admin" });

    await expect(
      prisma.organizationUser.findUnique({
        where: {
          userId_organizationId: {
            userId: remainingAdminId,
            organizationId,
          },
        },
      }),
    ).resolves.not.toBeNull();
    await expect(
      prisma.grant.count({
        where: {
          organizationId,
          principalType: GrantPrincipalType.USER,
          principalId: remainingAdminId,
          revokedAt: null,
        },
      }),
    ).resolves.toBe(1);
  });
});
