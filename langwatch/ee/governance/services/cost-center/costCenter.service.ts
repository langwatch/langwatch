// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * CostCenterService — org-scoped CRUD for cost centers plus assignment of
 * users, teams, and projects to a cost center. Pure accounting: nothing
 * here grants or restricts access.
 *
 * Archiving never nulls assignments. The bird-eye rollup maps a stored
 * costCenterId back to a name through the active cost centers only, so an
 * archived center's spend resolves as "Unassigned" without a backfill.
 *
 * Spec: specs/ai-gateway/governance/cost-centers.feature
 */
import type { PrismaClient } from "@prisma/client";

import { CostCenterRepository } from "../../repositories/costCenter.repository";

export class CostCenterNotFoundError extends Error {
  readonly code = "cost_center_not_found" as const;
  constructor() {
    super("Cost center not found");
    this.name = "CostCenterNotFoundError";
  }
}

export interface CostCenterRow {
  id: string;
  name: string;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
}

export class CostCenterService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repo: CostCenterRepository = new CostCenterRepository(),
  ) {}

  static create(prisma: PrismaClient): CostCenterService {
    return new CostCenterService(prisma);
  }

  async getAll({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<CostCenterRow[]> {
    const rows = await this.repo.findAll(this.prisma, { organizationId });
    return rows.map(toRow);
  }

  async getById({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<CostCenterRow | null> {
    const row = await this.repo.findById(this.prisma, { id, organizationId });
    return row ? toRow(row) : null;
  }

  async create({
    organizationId,
    name,
  }: {
    organizationId: string;
    name: string;
  }): Promise<CostCenterRow> {
    const row = await this.repo.create(this.prisma, { organizationId, name });
    return toRow(row);
  }

  async rename({
    id,
    organizationId,
    name,
  }: {
    id: string;
    organizationId: string;
    name: string;
  }): Promise<CostCenterRow> {
    const result = await this.repo.updateName(this.prisma, {
      id,
      organizationId,
      name,
    });
    if (result.count === 0) throw new CostCenterNotFoundError();
    return (await this.getById({ id, organizationId }))!;
  }

  async archive({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<void> {
    const result = await this.repo.archive(this.prisma, { id, organizationId });
    if (result.count === 0) throw new CostCenterNotFoundError();
  }

  /**
   * Assign (or clear, when costCenterId is null) the cost center on an org
   * member, a team, or a project. Validates the cost center belongs to the
   * org before writing, so a caller cannot point an entity at another org's
   * center. The target entity write is org-scoped in its WHERE clause.
   */
  async assignUser(params: {
    organizationId: string;
    userId: string;
    costCenterId: string | null;
  }): Promise<void> {
    await this.assertCostCenterInOrg(params);
    await this.prisma.organizationUser.updateMany({
      where: { userId: params.userId, organizationId: params.organizationId },
      data: { costCenterId: params.costCenterId },
    });
  }

  async assignTeam(params: {
    organizationId: string;
    teamId: string;
    costCenterId: string | null;
  }): Promise<void> {
    await this.assertCostCenterInOrg(params);
    await this.prisma.team.updateMany({
      where: { id: params.teamId, organizationId: params.organizationId },
      data: { costCenterId: params.costCenterId },
    });
  }

  async assignProject(params: {
    organizationId: string;
    projectId: string;
    costCenterId: string | null;
  }): Promise<void> {
    await this.assertCostCenterInOrg(params);
    await this.prisma.project.updateMany({
      where: {
        id: params.projectId,
        team: { organizationId: params.organizationId },
      },
      data: { costCenterId: params.costCenterId },
    });
  }

  private async assertCostCenterInOrg({
    organizationId,
    costCenterId,
  }: {
    organizationId: string;
    costCenterId: string | null;
  }): Promise<void> {
    if (costCenterId === null) return;
    const found = await this.repo.findById(this.prisma, {
      id: costCenterId,
      organizationId,
    });
    if (!found) throw new CostCenterNotFoundError();
  }
}

function toRow(row: {
  id: string;
  name: string;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
}): CostCenterRow {
  return {
    id: row.id,
    name: row.name,
    organizationId: row.organizationId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
