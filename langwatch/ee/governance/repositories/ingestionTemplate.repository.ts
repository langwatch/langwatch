// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Repository for IngestionTemplate row access.
 *
 * Single responsibility: every `prisma.ingestionTemplate.*` call in the
 * codebase lives here. The service layer (IngestionTemplateService)
 * delegates row reads/writes through this repository so it can stay
 * focused on transaction boundaries, validation, and audit emission.
 *
 * Per umbrella spec @repository-pattern + @no-bypass:
 *   - The service NEVER calls prisma.ingestionTemplate.* directly.
 *   - Each method accepts a `Prisma.TransactionClient | PrismaClient`
 *     so it can be invoked inside the service's `$transaction` blocks
 *     OR against the top-level prisma client for non-transactional reads.
 *
 * Spec: specs/ai-gateway/governance/governance-api-cli-mcp-coverage.feature
 */
import type { Prisma, PrismaClient } from "@prisma/client";

type Client = Prisma.TransactionClient | PrismaClient;

export class IngestionTemplateRepository {
  /**
   * User-facing union: platform-published rows + the caller's
   * org-authored rows. Disabled + archived rows excluded.
   */
  findUserVisibleForOrg(client: Client, params: { organizationId: string }) {
    return client.ingestionTemplate.findMany({
      where: {
        archivedAt: null,
        enabled: true,
        OR: [{ organizationId: null }, { organizationId: params.organizationId }],
      },
      orderBy: [{ platformPublished: "desc" }, { displayName: "asc" }],
    });
  }

  /** Admin shape: includes disabled rows but still excludes archived. */
  findAdminVisibleForOrg(
    client: Client,
    params: { organizationId: string },
  ) {
    return client.ingestionTemplate.findMany({
      where: {
        archivedAt: null,
        OR: [{ organizationId: null }, { organizationId: params.organizationId }],
      },
      orderBy: [{ platformPublished: "desc" }, { displayName: "asc" }],
    });
  }

  /**
   * Cross-org-safe lookup: returns the row only if it's a platform
   * default OR scoped to `organizationId`. Used by the public REST/tRPC
   * `findByIdForOrg` path; cross-org probes collapse to null.
   */
  findByIdForOrg(
    client: Client,
    params: { id: string; organizationId: string },
  ) {
    return client.ingestionTemplate.findFirst({
      where: {
        id: params.id,
        archivedAt: null,
        OR: [{ organizationId: null }, { organizationId: params.organizationId }],
      },
    });
  }

  /**
   * Strict org-scoped lookup used inside mutation transactions. Filters
   * by `organizationId === organizationId` (NOT null), so platform rows
   * never resolve through this path — admins must clone first.
   */
  findOrgScopedNonArchived(
    client: Client,
    params: {
      id: string;
      organizationId: string;
      select?: Prisma.IngestionTemplateSelect;
    },
  ) {
    return client.ingestionTemplate.findFirst({
      where: {
        id: params.id,
        archivedAt: null,
        organizationId: params.organizationId,
      },
      select: params.select,
    });
  }

  /** Platform-default lookup used by `cloneFromPlatform`. */
  findPlatformNonArchivedById(client: Client, params: { id: string }) {
    return client.ingestionTemplate.findFirst({
      where: {
        id: params.id,
        archivedAt: null,
        organizationId: null,
      },
    });
  }

  create(
    client: Client,
    data: Prisma.IngestionTemplateUncheckedCreateInput,
  ) {
    return client.ingestionTemplate.create({ data });
  }

  updateById(
    client: Client,
    params: {
      id: string;
      data: Prisma.IngestionTemplateUncheckedUpdateInput;
    },
  ) {
    return client.ingestionTemplate.update({
      where: { id: params.id },
      data: params.data,
    });
  }
}
