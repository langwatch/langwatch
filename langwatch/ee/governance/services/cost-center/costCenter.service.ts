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

/**
 * The user, team, or project an assignment targeted does not exist in the org.
 * Surfaced so the caller never reports a no-op assignment as success.
 */
export class CostCenterAssignmentTargetNotFoundError extends Error {
  readonly code = "cost_center_assignment_target_not_found" as const;
  constructor(target: "user" | "team" | "project") {
    super(`Assignment target ${target} not found in this organization`);
    this.name = "CostCenterAssignmentTargetNotFoundError";
  }
}

export interface CostCenterRow {
  id: string;
  name: string;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CostCenterAssignableEntity {
  id: string;
  name: string;
  costCenterId: string | null;
}

export interface CostCenterAssignments {
  users: CostCenterAssignableEntity[];
  teams: CostCenterAssignableEntity[];
  projects: CostCenterAssignableEntity[];
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

  /**
   * The members, teams, and projects an admin can assign, each with the
   * cost center currently stored on it. The admin UI joins these against
   * `getAll` to render the assignment pickers. A user shows the email when
   * no display name is set so the row is never blank.
   */
  async getAssignments({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<CostCenterAssignments> {
    const [members, teams, projects] = await Promise.all([
      this.prisma.organizationUser.findMany({
        where: { organizationId },
        select: {
          userId: true,
          costCenterId: true,
          user: { select: { name: true, email: true } },
        },
      }),
      this.prisma.team.findMany({
        where: { organizationId },
        select: { id: true, name: true, costCenterId: true },
        orderBy: { name: "asc" },
      }),
      this.prisma.project.findMany({
        where: { team: { organizationId } },
        select: { id: true, name: true, costCenterId: true },
        orderBy: { name: "asc" },
      }),
    ]);

    return {
      users: members
        .map((m) => ({
          id: m.userId,
          name: m.user.name ?? m.user.email ?? m.userId,
          costCenterId: m.costCenterId,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      teams,
      projects,
    };
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

  /**
   * Find an active cost center by name in the org, creating it if none
   * exists. Used by SCIM provisioning so an IdP can drive cost-center
   * membership by name without the admin pre-creating every center. Matches
   * an existing active center exactly by name; an archived center of the
   * same name does not block a fresh create.
   */
  async resolveByNameOrCreate({
    organizationId,
    name,
  }: {
    organizationId: string;
    name: string;
  }): Promise<CostCenterRow> {
    const existing = await this.prisma.costCenter.findFirst({
      where: { organizationId, name, archivedAt: null },
    });
    if (existing) return toRow(existing);
    return this.create({ organizationId, name });
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
    const result = await this.prisma.organizationUser.updateMany({
      where: { userId: params.userId, organizationId: params.organizationId },
      data: { costCenterId: params.costCenterId },
    });
    if (result.count === 0) {
      throw new CostCenterAssignmentTargetNotFoundError("user");
    }
  }

  async assignTeam(params: {
    organizationId: string;
    teamId: string;
    costCenterId: string | null;
  }): Promise<void> {
    await this.assertCostCenterInOrg(params);
    const result = await this.prisma.team.updateMany({
      where: { id: params.teamId, organizationId: params.organizationId },
      data: { costCenterId: params.costCenterId },
    });
    if (result.count === 0) {
      throw new CostCenterAssignmentTargetNotFoundError("team");
    }
  }

  async assignProject(params: {
    organizationId: string;
    projectId: string;
    costCenterId: string | null;
  }): Promise<void> {
    await this.assertCostCenterInOrg(params);
    const result = await this.prisma.project.updateMany({
      where: {
        id: params.projectId,
        team: { organizationId: params.organizationId },
      },
      data: { costCenterId: params.costCenterId },
    });
    if (result.count === 0) {
      throw new CostCenterAssignmentTargetNotFoundError("project");
    }
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
