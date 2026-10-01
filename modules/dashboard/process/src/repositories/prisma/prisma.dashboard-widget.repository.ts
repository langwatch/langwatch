/**
 * A lean twin of {@link SavedWorkbenchChartService}, kind-scoped by
 * {@link DASHBOARD_SRCDOC_CHART_KIND} + `projectId` so a widget is never
 * touched through the builder or workbench paths (see ../dashboardWidgetDefinition).
 */

import {
  DashboardWidgetNotFoundError,
  DashboardWidgetDefinitionInvalidError,
  DASHBOARD_SRCDOC_CHART_KIND,
  type DashboardWidgetDefinitionInput,
} from "@langwatch/analytics-contract";
import {
  CHART_GRID_DEFAULT_COL_SPAN,
  CHART_GRID_DEFAULT_ROW_SPAN,
  chartGridBottomRow,
} from "@langwatch/analytics-contract/chart-grid";
import {
  DASHBOARD_WIDGET_DEFINITION_VERSION,
  dashboardWidgetDefinitionSchema,
} from "@langwatch/analytics-contract/dashboard-widget-definition";
import { PrismaRepository } from "@langwatch/prisma-client";
import type { CustomGraph, Prisma } from "@langwatch/prisma-client/generated";
import { fromDate } from "@langwatch/time";

import type {
  DashboardWidgetLayoutsInput,
  DashboardWidgetRepository,
  DashboardWidgetRow,
} from "../dashboard-widget.repository.ts";
import { PrismaDashboardOwnershipRepository } from "./prisma.dashboard-ownership.repository.ts";

const graphOf = (input: DashboardWidgetDefinitionInput): Prisma.InputJsonValue => ({
  version: DASHBOARD_WIDGET_DEFINITION_VERSION,
  code: input.code,
  queries: [...input.queries],
});

export class PrismaDashboardWidgetRepository
  extends PrismaRepository.transactionalFor("CustomGraph", "Dashboard")
  implements DashboardWidgetRepository
{
  static readonly create = this.factory((prisma) => new PrismaDashboardWidgetRepository(prisma));

  /** Every dashboard widget in a project, ordered as the page shows them. */
  async findAll({ projectId }: { projectId: string }): Promise<DashboardWidgetRow[]> {
    const rows = await this.prisma.customGraph.findMany({
      where: { projectId, kind: DASHBOARD_SRCDOC_CHART_KIND },
      orderBy: [{ gridRow: "asc" }, { gridColumn: "asc" }],
    });
    return rows.map((row) => this.#present(row));
  }

  /**
   * One dashboard widget.
   * @throws {DashboardWidgetNotFoundError} when no widget of this kind has
   *   that id in this project — including when it has that id in another one.
   */
  async getById({ id, projectId }: { id: string; projectId: string }): Promise<DashboardWidgetRow> {
    const row = await this.prisma.customGraph.findFirst({
      where: { id, projectId, kind: DASHBOARD_SRCDOC_CHART_KIND },
    });
    if (!row) throw new DashboardWidgetNotFoundError();
    return this.#present(row);
  }

  /**
   * Saves a new widget below the lowest row it would collide with; row
   * computation and write share one transaction so concurrent creates can't race.
   * @throws {DashboardWidgetNotFoundError} when `dashboardId` names no dashboard here (IDOR).
   */
  async createWidget({
    id,
    projectId,
    dashboardId,
    input,
  }: {
    /** Minted by the service under the house id scheme, as every sibling card is. */
    id: string;
    projectId: string;
    /** When placing on a dashboard; absent for the unplaced authoring grid. */
    dashboardId?: string;
    input: { name: string } & DashboardWidgetDefinitionInput;
  }): Promise<DashboardWidgetRow> {
    const row = await this.transaction(async (tx) => {
      if (
        dashboardId !== undefined &&
        !(await PrismaDashboardOwnershipRepository.create({ prisma: tx }).belongsToProject({
          dashboardId,
          projectId,
        }))
      ) {
        throw new DashboardWidgetNotFoundError();
      }

      // Scoped to the placement target: a card on another dashboard must not
      // push this one down. Unplaced widgets share the kind-scoped authoring
      // grid; a placed one shares the whole target dashboard's grid.
      const existing = await tx.customGraph.findMany({
        where:
          dashboardId === undefined
            ? { projectId, kind: DASHBOARD_SRCDOC_CHART_KIND }
            : { projectId, dashboardId },
        select: { gridRow: true, rowSpan: true },
      });

      return tx.customGraph.create({
        data: {
          id,
          projectId,
          name: input.name,
          kind: DASHBOARD_SRCDOC_CHART_KIND,
          graph: graphOf(input),
          ...(dashboardId === undefined ? {} : { dashboardId }),
          gridColumn: 0,
          gridRow: chartGridBottomRow(existing),
          colSpan: CHART_GRID_DEFAULT_COL_SPAN,
          rowSpan: CHART_GRID_DEFAULT_ROW_SPAN,
        },
      });
    });
    return this.#present(row);
  }

  /**
   * Updates a widget's name, its definition, or both, then returns it.
   * @throws {DashboardWidgetNotFoundError} when the update touches no row —
   *   a missing id, or one in another project.
   */
  async updateWidget({
    id,
    projectId,
    input,
  }: {
    id: string;
    projectId: string;
    input: { name?: string } & Partial<DashboardWidgetDefinitionInput>;
  }): Promise<DashboardWidgetRow> {
    await this.transaction(async (tx) => {
      const data: Prisma.CustomGraphUpdateManyMutationInput = {};
      if (input.name !== undefined) data.name = input.name;

      if (input.code !== undefined || input.queries !== undefined) {
        data.graph = await this.#mergeDefinitionUpdate({
          tx,
          id,
          projectId,
          input,
        });
      }

      const result = await tx.customGraph.updateMany({
        where: { id, projectId, kind: DASHBOARD_SRCDOC_CHART_KIND },
        data,
      });
      if (result.count === 0) throw new DashboardWidgetNotFoundError();
    });
    return this.getById({ id, projectId });
  }

  /**
   * A partial update keeps the untouched half: `code` alone must not blank
   * the stored queries, nor `queries` alone the stored code. The `graph`
   * column is one JSON blob, re-read and re-merged in the caller's transaction.
   */
  async #mergeDefinitionUpdate({
    tx,
    id,
    projectId,
    input,
  }: {
    tx: Pick<Prisma.TransactionClient, "customGraph">;
    id: string;
    projectId: string;
    input: Partial<DashboardWidgetDefinitionInput>;
  }): Promise<Prisma.CustomGraphUpdateManyMutationInput["graph"]> {
    const current = await tx.customGraph.findFirst({
      where: { id, projectId, kind: DASHBOARD_SRCDOC_CHART_KIND },
    });
    if (!current) throw new DashboardWidgetNotFoundError();
    const parsed = dashboardWidgetDefinitionSchema.safeParse(current.graph);
    if (!parsed.success) {
      throw new DashboardWidgetDefinitionInvalidError(current.id, { reasons: [parsed.error] });
    }
    const definition = parsed.data;
    return graphOf({
      code: input.code ?? definition.code,
      queries: input.queries ?? definition.queries,
    });
  }

  /**
   * Deletes a widget.
   * @throws {DashboardWidgetNotFoundError} when nothing was deleted, so a
   *   caller cannot tell a foreign id from a gone one by the status.
   */
  async deleteWidget({ id, projectId }: { id: string; projectId: string }): Promise<void> {
    const result = await this.prisma.customGraph.deleteMany({
      where: { id, projectId, kind: DASHBOARD_SRCDOC_CHART_KIND },
    });
    if (result.count === 0) throw new DashboardWidgetNotFoundError();
  }

  /**
   * Adds a widget to a dashboard at the next free row; row computation and
   * write share one transaction so concurrent assignments can't overlap.
   * @throws {DashboardWidgetNotFoundError} when the dashboard/widget isn't in this project (IDOR).
   */
  async assignToDashboard({
    id,
    projectId,
    dashboardId,
  }: {
    id: string;
    projectId: string;
    dashboardId: string;
  }): Promise<DashboardWidgetRow> {
    await this.transaction(async (tx) => {
      if (
        !(await PrismaDashboardOwnershipRepository.create({ prisma: tx }).belongsToProject({
          dashboardId,
          projectId,
        }))
      ) {
        throw new DashboardWidgetNotFoundError();
      }
      // Next free row on the TARGET dashboard across every kind (gridRow is shared
      // between the widget-authoring grid and dashboard grid — accepted prototype coupling).
      const onDashboard = await tx.customGraph.findMany({
        where: { projectId, dashboardId },
        select: { gridRow: true, rowSpan: true },
      });
      const result = await tx.customGraph.updateMany({
        where: { id, projectId, kind: DASHBOARD_SRCDOC_CHART_KIND },
        data: {
          dashboardId,
          gridColumn: 0,
          gridRow: chartGridBottomRow(onDashboard),
          // colSpan/rowSpan intentionally untouched — keep the widget's size.
        },
      });
      if (result.count === 0) throw new DashboardWidgetNotFoundError();
    });
    return this.getById({ id, projectId });
  }

  /** Kind-scoped `updateMany` per widget in one transaction; a miss updates nothing. */
  async updateLayouts({ projectId, layouts }: DashboardWidgetLayoutsInput): Promise<void> {
    await this.transaction(async (tx) => {
      for (const { graphId, layout } of layouts) {
        await tx.customGraph.updateMany({
          where: { id: graphId, projectId, kind: DASHBOARD_SRCDOC_CHART_KIND },
          data: {
            gridColumn: layout.gridColumn,
            gridRow: layout.gridRow,
            colSpan: layout.colSpan,
            rowSpan: layout.rowSpan,
          },
        });
      }
    });
  }

  #present(row: CustomGraph): DashboardWidgetRow {
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      graph: row.graph,
      createdAt: fromDate(row.createdAt),
      updatedAt: fromDate(row.updatedAt),
      dashboardId: row.dashboardId,
      gridColumn: row.gridColumn,
      gridRow: row.gridRow,
      colSpan: row.colSpan,
      rowSpan: row.rowSpan,
    };
  }
}
