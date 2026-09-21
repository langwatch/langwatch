/**
 * A key is handed out only once its grants are readable.
 *
 * Against a real database on purpose. The failure this pins was not a thrown
 * error anywhere: the ledger append was durable, the projection had not landed
 * the rows, the bounded wait timed out and said so only in a log line, and the
 * mint went on to activate the key. The proof therefore has to be the stored
 * row, which a mocked repository cannot give.
 *
 * The fold is not running here, so a command that is "sent" and never applied
 * is exactly the degraded stack: the rows never appear. The other half of the
 * test writes the rows from the sender, which is what a healthy fold does.
 *
 * @see specs/api-keys/unified-api-keys.feature
 */

import { HandledError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OrganizationUserRole,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import {
  type AuthzGrantsCommandSenders,
  GrantsLedgerWriter,
} from "~/server/app-layer/authz/ledger";
import { prisma } from "~/server/db";
import { RoleRepository } from "~/server/role/repositories/role.repository";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { KSUID_RESOURCES } from "~/utils/constants";
import { ApiKeyRepository } from "../api-key.repository";
import { ApiKeyService } from "../api-key.service";

/** The commands of a stack whose fold never applies them. */
function sendersThatNeverLand(): AuthzGrantsCommandSenders {
  const noop = { send: async () => undefined };
  return {
    attachGrant: noop,
    changeGrantRole: noop,
    revokeGrant: noop,
    defineRole: noop,
    changeRolePermissions: noop,
    deleteRole: noop,
  } as unknown as AuthzGrantsCommandSenders;
}

/** The commands of a healthy stack: the fold writes the row the caller polls for. */
function sendersThatLand({
  organizationId,
}: {
  organizationId: string;
}): AuthzGrantsCommandSenders {
  const noop = { send: async () => undefined };
  return {
    ...sendersThatNeverLand(),
    attachGrant: {
      send: async (data: {
        grant: {
          grantId: string;
          principal: { type: string; id: string };
          scope: { type: string; id: string };
        };
      }) => {
        await prisma.roleBinding.create({
          data: {
            id: data.grant.grantId,
            organizationId,
            apiKeyId: data.grant.principal.id,
            role: TeamUserRole.ADMIN,
            scopeType: data.grant.scope.type as RoleBindingScopeType,
            scopeId: data.grant.scope.id,
          },
        });
      },
    },
    revokeGrant: noop,
  } as unknown as AuthzGrantsCommandSenders;
}

describe("Feature: a key is activated only once its grants are readable", () => {
  const ns = `apikey-grants-${nanoid(8)}`;

  let organizationId: string;
  let userId: string;

  /** The service over a writer whose projection either lands or does not. */
  const serviceWith = (commands: AuthzGrantsCommandSenders) => {
    const writer = new GrantsLedgerWriter(prisma as unknown as PrismaClient, {
      onLedgerWrites: async () => true,
      // Short on purpose: the point is the window closing, not how long a
      // real one is.
      poll: { intervalMs: 10, timeoutMs: 150 },
      commands: async () => ({ commands }),
    });
    return new ApiKeyService({
      prisma,
      repo: new ApiKeyRepository(prisma, writer),
      roleRepo: new RoleRepository(prisma),
    });
  };

  const mint = (service: ApiKeyService) =>
    service.create({
      name: `grants-${nanoid(6)}`,
      userId: null,
      createdByUserId: userId,
      organizationId,
      permissionMode: "all",
      bindings: [
        {
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organizationId,
        },
      ],
    });

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "Grant Confirmation Org", slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;

    const user = await prisma.user.create({
      data: {
        name: "Grant Confirmation User",
        email: `test-${ns}@example.com`,
      },
    });
    userId = user.id;

    await prisma.organizationUser.create({
      data: { userId, organizationId, role: OrganizationUserRole.ADMIN },
    });
    await prisma.roleBinding.create({
      data: {
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId,
        userId,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organizationId,
      },
    });
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["roleBinding", { organizationId }],
      ["apiKey", { organizationId }],
      ["organizationUser", { organizationId }],
    ]);
    await prisma.organization
      .delete({ where: { id: organizationId } })
      .catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  });

  describe("given the grants land in the projection", () => {
    /** @scenario "A key whose grants are readable is activated and returned" */
    it("returns a token that authenticates", async () => {
      const service = serviceWith(sendersThatLand({ organizationId }));

      const { token, apiKey } = await mint(service);

      expect(apiKey.revokedAt).toBeNull();
      const verified = await service.verify({ token });
      expect(verified?.id).toBe(apiKey.id);
    });
  });

  describe("given the grants are durable but their projection has not landed", () => {
    /** @scenario "A key whose grants did not become readable is never activated" */
    it("refuses the mint and leaves no usable key behind", async () => {
      const service = serviceWith(sendersThatNeverLand());
      const before = await prisma.apiKey.count({
        where: { organizationId, revokedAt: null },
      });

      const failure = await mint(service).then(
        () => null,
        (error: unknown) => error,
      );

      expect(HandledError.isHandled(failure)).toBe(true);
      expect((failure as HandledError).code).toBe("authz_grant_not_confirmed");

      // The row the failed mint left behind is revoked, so it authenticates
      // nothing: the count of live keys did not move.
      const after = await prisma.apiKey.count({
        where: { organizationId, revokedAt: null },
      });
      expect(after).toBe(before);

      const stranded = await prisma.apiKey.findFirst({
        where: { organizationId, revokedAt: { not: null } },
        orderBy: { createdAt: "desc" },
        include: { roleBindings: true },
      });
      expect(stranded?.revokedAt).toBeInstanceOf(Date);
      expect(stranded?.roleBindings).toHaveLength(0);
    });
  });
});
