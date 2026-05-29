// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Repository for CostCenter row access. Every `prisma.costCenter.*` call
 * lives here; the service delegates through it and owns validation, org
 * scoping, and assignment orchestration.
 *
 * Spec: specs/ai-gateway/governance/cost-centers.feature
 */
import type { Prisma, PrismaClient } from "@prisma/client";

type Client = Prisma.TransactionClient | PrismaClient;

export class CostCenterRepository {
  findAll(client: Client, params: { organizationId: string }) {
    return client.costCenter.findMany({
      where: { organizationId: params.organizationId, archivedAt: null },
      orderBy: { name: "asc" },
    });
  }

  /** Cross-org-safe: returns the row only when it belongs to the org. */
  findById(
    client: Client,
    params: { id: string; organizationId: string },
  ) {
    return client.costCenter.findFirst({
      where: {
        id: params.id,
        organizationId: params.organizationId,
        archivedAt: null,
      },
    });
  }

  create(
    client: Client,
    params: { organizationId: string; name: string },
  ) {
    return client.costCenter.create({
      data: { organizationId: params.organizationId, name: params.name },
    });
  }

  updateName(
    client: Client,
    params: { id: string; organizationId: string; name: string },
  ) {
    return client.costCenter.updateMany({
      where: { id: params.id, organizationId: params.organizationId },
      data: { name: params.name },
    });
  }

  archive(client: Client, params: { id: string; organizationId: string }) {
    return client.costCenter.updateMany({
      where: { id: params.id, organizationId: params.organizationId },
      data: { archivedAt: new Date() },
    });
  }
}
