// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * DepartmentService - org-scoped CRUD for departments plus assignment of
 * users, teams, and projects to a department. Pure accounting: nothing
 * here grants or restricts access.
 *
 * Archiving never nulls assignments. The bird-eye rollup maps a stored
 * departmentId back to a name through the active departments only, so an
 * archived department's spend resolves as "Unassigned" without a backfill.
 *
 * Spec: specs/ai-gateway/governance/departments.feature
 */
import type { PrismaClient } from "@prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";

import { DepartmentRepository } from "../../repositories/department.repository";

export class DepartmentNotFoundError extends Error {
  readonly code = "department_not_found" as const;
  constructor() {
    super("Department not found");
    this.name = "DepartmentNotFoundError";
  }
}

/**
 * The user, team, or project an assignment targeted does not exist in the org.
 * Surfaced so the caller never reports a no-op assignment as success.
 */
export class DepartmentAssignmentTargetNotFoundError extends Error {
  readonly code = "department_assignment_target_not_found" as const;
  constructor(target: "user" | "team" | "project") {
    super(`Assignment target ${target} not found in this organization`);
    this.name = "DepartmentAssignmentTargetNotFoundError";
  }
}

export interface DepartmentRow {
  id: string;
  name: string;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DepartmentAssignableEntity {
  id: string;
  name: string;
  departmentId: string | null;
}

export interface DepartmentAssignments {
  users: DepartmentAssignableEntity[];
  teams: DepartmentAssignableEntity[];
  projects: DepartmentAssignableEntity[];
}

export class DepartmentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repo: DepartmentRepository = new DepartmentRepository(),
  ) {}

  static create(prisma: PrismaClient): DepartmentService {
    return new DepartmentService(prisma);
  }

  async getAll({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<DepartmentRow[]> {
    const rows = await this.repo.findAll(this.prisma, { organizationId });
    return rows.map(toRow);
  }

  async getById({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<DepartmentRow | null> {
    const row = await this.repo.findById(this.prisma, { id, organizationId });
    return row ? toRow(row) : null;
  }

  /**
   * The members, teams, and projects an admin can assign, each with the
   * department currently stored on it. The admin UI joins these against
   * `getAll` to render the assignment pickers. A user shows the email when
   * no display name is set so the row is never blank.
   */
  async getAssignments({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<DepartmentAssignments> {
    const [members, teams, projects] = await Promise.all([
      this.prisma.organizationUser.findMany({
        where: { organizationId },
        select: {
          userId: true,
          departmentId: true,
          user: { select: { name: true, email: true } },
        },
      }),
      this.prisma.team.findMany({
        where: { organizationId },
        select: { id: true, name: true, departmentId: true },
        orderBy: { name: "asc" },
      }),
      this.prisma.project.findMany({
        where: { team: { organizationId } },
        select: { id: true, name: true, departmentId: true },
        orderBy: { name: "asc" },
      }),
    ]);

    return {
      users: members
        .map((m) => ({
          id: m.userId,
          name: m.user.name ?? m.user.email ?? m.userId,
          departmentId: m.departmentId,
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
  }): Promise<DepartmentRow> {
    const row = await this.repo.create(this.prisma, { organizationId, name });
    return toRow(row);
  }

  /**
   * Find an active department by name in the org, creating it if none
   * exists. Used by SCIM provisioning so an IdP can drive department
   * membership by name without the admin pre-creating every department.
   * Matches an existing active department exactly by name; an archived
   * department of the same name does not block a fresh create.
   */
  async resolveByNameOrCreate({
    organizationId,
    name,
  }: {
    organizationId: string;
    name: string;
  }): Promise<DepartmentRow> {
    const existing = await this.prisma.department.findFirst({
      where: { organizationId, name, archivedAt: null },
    });
    if (existing) return toRow(existing);
    try {
      return await this.create({ organizationId, name });
    } catch (e) {
      // A concurrent provision of the same name may have won the race. The
      // partial unique index on (organizationId, name) WHERE archivedAt IS NULL
      // rejects the duplicate with P2002, so re-fetch the active row that won.
      if (e instanceof PrismaClientKnownRequestError && e.code === "P2002") {
        const winner = await this.prisma.department.findFirst({
          where: { organizationId, name, archivedAt: null },
        });
        if (winner) return toRow(winner);
      }
      throw e;
    }
  }

  async rename({
    id,
    organizationId,
    name,
  }: {
    id: string;
    organizationId: string;
    name: string;
  }): Promise<DepartmentRow> {
    const result = await this.repo.updateName(this.prisma, {
      id,
      organizationId,
      name,
    });
    if (result.count === 0) throw new DepartmentNotFoundError();
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
    if (result.count === 0) throw new DepartmentNotFoundError();
  }

  /**
   * Assign (or clear, when departmentId is null) the department on an org
   * member, a team, or a project. Validates the department belongs to the
   * org before writing, so a caller cannot point an entity at another org's
   * department. The target entity write is org-scoped in its WHERE clause.
   */
  async assignUser(params: {
    organizationId: string;
    userId: string;
    departmentId: string | null;
  }): Promise<void> {
    await this.assertDepartmentInOrg(params);
    const result = await this.prisma.organizationUser.updateMany({
      where: { userId: params.userId, organizationId: params.organizationId },
      data: { departmentId: params.departmentId },
    });
    if (result.count === 0) {
      throw new DepartmentAssignmentTargetNotFoundError("user");
    }
  }

  async assignTeam(params: {
    organizationId: string;
    teamId: string;
    departmentId: string | null;
  }): Promise<void> {
    await this.assertDepartmentInOrg(params);
    const result = await this.prisma.team.updateMany({
      where: { id: params.teamId, organizationId: params.organizationId },
      data: { departmentId: params.departmentId },
    });
    if (result.count === 0) {
      throw new DepartmentAssignmentTargetNotFoundError("team");
    }
  }

  async assignProject(params: {
    organizationId: string;
    projectId: string;
    departmentId: string | null;
  }): Promise<void> {
    await this.assertDepartmentInOrg(params);
    const result = await this.prisma.project.updateMany({
      where: {
        id: params.projectId,
        team: { organizationId: params.organizationId },
      },
      data: { departmentId: params.departmentId },
    });
    if (result.count === 0) {
      throw new DepartmentAssignmentTargetNotFoundError("project");
    }
  }

  private async assertDepartmentInOrg({
    organizationId,
    departmentId,
  }: {
    organizationId: string;
    departmentId: string | null;
  }): Promise<void> {
    if (departmentId === null) return;
    const found = await this.repo.findById(this.prisma, {
      id: departmentId,
      organizationId,
    });
    if (!found) throw new DepartmentNotFoundError();
  }
}

function toRow(row: {
  id: string;
  name: string;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
}): DepartmentRow {
  return {
    id: row.id,
    name: row.name,
    organizationId: row.organizationId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
