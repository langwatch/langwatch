// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Repository for UserIngestionBinding row access.
 *
 * Single responsibility: every `prisma.userIngestionBinding.*` call in
 * the codebase lives here. The service layer enforces invariants
 * (cross-bind structural impossibility, hard-cut rotation v1) and owns
 * transactions; this repository owns the row-level shape.
 *
 * Per umbrella spec @repository-pattern + @no-bypass.
 */
import type { Prisma, PrismaClient } from "@prisma/client";

type Client = Prisma.TransactionClient | PrismaClient;

export class UserIngestionBindingRepository {
  /**
   * Install identity: race-safe upsert keyed on the
   * (personalProjectId, sourceType) UNIQUE. `update` rotates the token
   * in place (and revives a soft-archived row); `create` mints a fresh
   * binding. Per-personal-project keying scopes the binding to one
   * (user, org) so multi-org users never collide.
   */
  upsertByProjectAndSource(
    client: Client,
    params: {
      personalProjectId: string;
      sourceType: string;
      create: Prisma.UserIngestionBindingUncheckedCreateInput;
      update: Prisma.UserIngestionBindingUncheckedUpdateInput;
    },
  ) {
    return client.userIngestionBinding.upsert({
      where: {
        personalProjectId_sourceType: {
          personalProjectId: params.personalProjectId,
          sourceType: params.sourceType,
        },
      },
      create: params.create,
      update: params.update,
    });
  }

  /** Caller-scoped list within an organization. */
  findManyForCallerInOrg(
    client: Client,
    params: { userId: string; organizationId: string },
  ) {
    return client.userIngestionBinding.findMany({
      where: {
        userId: params.userId,
        organizationId: params.organizationId,
        archivedAt: null,
      },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Owned-by-caller lookup. Strict ownership filter — the receiver path
   * uses `findUniqueByHashForReceive` instead since it operates pre-auth.
   */
  findOwnedNonArchived(
    client: Client,
    params: {
      bindingId: string;
      userId: string;
      organizationId: string;
      select?: Prisma.UserIngestionBindingSelect;
    },
  ) {
    return client.userIngestionBinding.findFirst({
      where: {
        id: params.bindingId,
        userId: params.userId,
        organizationId: params.organizationId,
        archivedAt: null,
      },
      select: params.select,
    });
  }

  /**
   * Defense-in-depth re-verify used by the receiver auth path AFTER a
   * candidate hash matches the indexed column. Returns the joined
   * personal-project state so callers can re-assert ownership +
   * `isPersonal === true` invariants.
   */
  findUniqueByHashForReceive(
    client: Client,
    params: { bindingAccessTokenHash: string },
  ) {
    return client.userIngestionBinding.findUnique({
      where: { bindingAccessTokenHash: params.bindingAccessTokenHash },
      select: {
        id: true,
        userId: true,
        templateId: true,
        sourceType: true,
        personalProjectId: true,
        organizationId: true,
        enabled: true,
        archivedAt: true,
        personalProject: {
          select: { isPersonal: true, ownerUserId: true, archivedAt: true },
        },
      },
    });
  }

  create(
    client: Client,
    data: Prisma.UserIngestionBindingUncheckedCreateInput,
  ) {
    return client.userIngestionBinding.create({ data });
  }

  updateById(
    client: Client,
    params: {
      id: string;
      data: Prisma.UserIngestionBindingUncheckedUpdateInput;
    },
  ) {
    return client.userIngestionBinding.update({
      where: { id: params.id },
      data: params.data,
    });
  }

  /**
   * Resolves the caller's personal project within `organizationId` via
   * the User → Project (ownerUserId, isPersonal=true) → Team → Org
   * ladder. Bound to the binding flow because the cross-bind invariant
   * requires `Project.ownerUserId === callerUserId` AND `isPersonal`,
   * which is binding-specific (not a generic project lookup). The call
   * lives on this repository so the service stays free of direct
   * `prisma.project.*` access per umbrella spec @repository-pattern.
   *
   * Project is exempt from both `dbMultiTenancyProtection` and
   * `dbOrganizationIdProtection` middlewares, so this query runs without
   * tripping the projectId/organizationId guards. The team join keeps
   * the org boundary explicit.
   */
  findOwnedPersonalProjectInOrg(
    client: Client,
    params: { callerUserId: string; organizationId: string },
  ) {
    return client.project.findFirst({
      where: {
        ownerUserId: params.callerUserId,
        isPersonal: true,
        archivedAt: null,
        team: { organizationId: params.organizationId, archivedAt: null },
      },
      select: {
        id: true,
        team: { select: { organizationId: true } },
      },
    });
  }
}
