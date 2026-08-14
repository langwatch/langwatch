/**
 * Saved workbench charts over Prisma.
 *
 * Data access only: it stores what it is given and never decides whether the
 * definition inside is allowed — that is the service's job, and splitting them
 * is what makes "the service is the only write path" a checkable claim rather
 * than a convention.
 *
 * Two things are true of every query here, and neither is optional:
 * `projectId`, which the multitenancy middleware requires, and
 * {@link WORKBENCH_SQL_CHART_KIND}, without which a chart-builder row could be
 * read, updated or deleted through this repository as though it were a saved
 * workbench chart.
 *
 * @see specs/analytics/governed-sql-saved-charts.feature
 */

import type {
  CustomGraph,
  Prisma,
  PrismaClient,
} from "~/generated/prisma/client";

import { WORKBENCH_SQL_CHART_KIND } from "../chartKinds";

export type CreateSavedWorkbenchChartInput = {
  id: string;
  projectId: string;
  name: string;
  /** The versioned definition, already validated by the service. */
  definition: Prisma.InputJsonValue;
};

export type UpdateSavedWorkbenchChartInput = {
  id: string;
  projectId: string;
  name?: string;
  /** The versioned definition, already validated by the service. */
  definition?: Prisma.InputJsonValue;
};

/**
 * What the service needs from storage, and the whole of it.
 *
 * Named separately from the class so a suite can drive the service against an
 * in-memory store instead of a database — the claims worth proving about the
 * gate are "was anything written at all" and "what was written", which are
 * artifacts to inspect rather than calls to verify.
 */
export interface SavedWorkbenchChartStore {
  findAll(input: { projectId: string }): Promise<CustomGraph[]>;
  findById(input: {
    id: string;
    projectId: string;
  }): Promise<CustomGraph | null>;
  create(input: CreateSavedWorkbenchChartInput): Promise<CustomGraph>;
  update(input: UpdateSavedWorkbenchChartInput): Promise<CustomGraph | null>;
  delete(input: { id: string; projectId: string }): Promise<number>;
}

export class SavedWorkbenchChartRepository implements SavedWorkbenchChartStore {
  constructor(private readonly prisma: PrismaClient) {}

  /** Finds every saved workbench chart in a project, newest first. */
  async findAll(input: { projectId: string }): Promise<CustomGraph[]> {
    return await this.prisma.customGraph.findMany({
      where: {
        projectId: input.projectId,
        kind: WORKBENCH_SQL_CHART_KIND,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Finds one saved workbench chart by id within a project. */
  async findById(input: {
    id: string;
    projectId: string;
  }): Promise<CustomGraph | null> {
    return await this.prisma.customGraph.findFirst({
      where: {
        id: input.id,
        projectId: input.projectId,
        kind: WORKBENCH_SQL_CHART_KIND,
      },
    });
  }

  async create(input: CreateSavedWorkbenchChartInput): Promise<CustomGraph> {
    return await this.prisma.customGraph.create({
      data: {
        id: input.id,
        projectId: input.projectId,
        name: input.name,
        graph: input.definition,
        kind: WORKBENCH_SQL_CHART_KIND,
      },
    });
  }

  /**
   * Updates one saved workbench chart.
   *
   * Returns `null` when nothing matched, rather than throwing Prisma's own
   * not-found: the predicate carries the project and the kind, so "no rows" is
   * the ordinary answer for another tenant's id and the caller turns it into
   * the refusal it wants.
   */
  async update(
    input: UpdateSavedWorkbenchChartInput,
  ): Promise<CustomGraph | null> {
    // One statement: `UPDATE ... RETURNING` answers with the row it wrote, so
    // there is no window in which another writer's delete could turn a
    // successful update into a not-found read-back.
    const updated = await this.prisma.customGraph.updateManyAndReturn({
      where: {
        id: input.id,
        projectId: input.projectId,
        kind: WORKBENCH_SQL_CHART_KIND,
      },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.definition === undefined ? {} : { graph: input.definition }),
      },
    });
    return updated[0] ?? null;
  }

  /** Deletes one saved workbench chart. Answers how many rows went. */
  async delete(input: { id: string; projectId: string }): Promise<number> {
    const deleted = await this.prisma.customGraph.deleteMany({
      where: {
        id: input.id,
        projectId: input.projectId,
        kind: WORKBENCH_SQL_CHART_KIND,
      },
    });
    return deleted.count;
  }
}
