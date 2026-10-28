import {
  DashboardWidgetNotFoundError,
  DashboardWidgetDefinitionInvalidError,
  DASHBOARD_SRCDOC_CHART_KIND,
  type DashboardWidgetDefinitionInput,
  type DashboardWidgetDefinitionUpdate,
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
import { DashboardNotFoundError } from "@langwatch/dashboard-contract";
import { PrismaRepository } from "@langwatch/prisma-client";
import type {
  DashboardWidget as DashboardWidgetRecord,
  Prisma,
} from "@langwatch/prisma-client/generated";
import { fromDate } from "@langwatch/time";

import type {
  DashboardWidgetLayoutsInput,
  DashboardWidgetRepository,
  DashboardWidgetRow,
} from "../dashboard-widget.repository.ts";

const graphOf = (input: DashboardWidgetDefinitionInput): Prisma.InputJsonValue => ({
  version: DASHBOARD_WIDGET_DEFINITION_VERSION,
  code: input.code,
  queries: [...input.queries],
  ...(input.description === undefined ? {} : { description: input.description }),
  ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
  ...(input.source === undefined ? {} : { source: input.source }),
  ...(input.excludedOrigins === undefined ? {} : { excludedOrigins: [...input.excludedOrigins] }),
});

/** A transaction over the board table, to check a placement inside the write it guards. */
type BoardReads = Pick<Prisma.TransactionClient, "dashboardsV2">;

/** Whether the board is one of the project's own Dashboards boards. */
async function ownsBoard(
  tx: BoardReads,
  input: { dashboardId: string; projectId: string },
): Promise<boolean> {
  const board = await tx.dashboardsV2.findFirst({
    where: { id: input.dashboardId, projectId: input.projectId },
    select: { id: true },
  });
  return board !== null;
}

/**
 * The Dashboards widgets, in DashboardWidget, placed on DashboardsV2 boards. A widget delete
 * also removes its stale srcdoc copy left in CustomGraph by the split.
 */
export class PrismaDashboardWidgetRepository
  extends PrismaRepository.transactionalFor("DashboardWidget", "DashboardsV2", "CustomGraph")
  implements DashboardWidgetRepository
{
  static readonly create = this.factory((prisma) => new PrismaDashboardWidgetRepository(prisma));

  /** Every dashboard widget in a project, ordered as the page shows them. */
  async findAll({ projectId }: { projectId: string }): Promise<DashboardWidgetRow[]> {
    const rows = await this.prisma.dashboardWidget.findMany({
      where: { projectId },
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
    const row = await this.prisma.dashboardWidget.findFirst({ where: { id, projectId } });
    if (!row) throw new DashboardWidgetNotFoundError();
    return this.#present(row);
  }

  /**
   * Saves a new widget below the lowest row it would collide with; row
   * computation and write share one transaction so concurrent creates can't race.
   * @throws {DashboardNotFoundError} when `dashboardId` names no dashboard here (IDOR).
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
      if (dashboardId !== undefined && !(await ownsBoard(tx, { dashboardId, projectId }))) {
        throw new DashboardNotFoundError(projectId);
      }

      // Scoped to the placement target: a card on another dashboard must not push this one
      // down. Unplaced widgets share the project's authoring grid.
      const existing = await tx.dashboardWidget.findMany({
        where: dashboardId === undefined ? { projectId } : { projectId, dashboardId },
        select: { gridRow: true, rowSpan: true },
      });

      return tx.dashboardWidget.create({
        data: {
          id,
          projectId,
          name: input.name,
          definition: graphOf(input),
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
    input: { name?: string } & DashboardWidgetDefinitionUpdate;
  }): Promise<DashboardWidgetRow> {
    await this.transaction(async (tx) => {
      const data: Prisma.DashboardWidgetUpdateManyMutationInput = {};
      if (input.name !== undefined) data.name = input.name;

      const { name: _name, ...definitionFields } = input;
      const touchesDefinition = Object.values(definitionFields).some(
        (value) => value !== undefined,
      );
      if (touchesDefinition) {
        data.definition = await this.#mergeDefinitionUpdate({
          tx,
          id,
          projectId,
          input,
        });
      }

      const result = await tx.dashboardWidget.updateMany({ where: { id, projectId }, data });
      if (result.count === 0) throw new DashboardWidgetNotFoundError();
    });
    return this.getById({ id, projectId });
  }

  /**
   * A partial update keeps the untouched half: `code` alone must not blank
   * the stored queries, nor `queries` alone the stored code. The `definition`
   * column is one JSON blob, re-read and re-merged in the caller's transaction.
   */
  async #mergeDefinitionUpdate({
    tx,
    id,
    projectId,
    input,
  }: {
    tx: Pick<Prisma.TransactionClient, "dashboardWidget">;
    id: string;
    projectId: string;
    input: DashboardWidgetDefinitionUpdate;
  }): Promise<Prisma.DashboardWidgetUpdateManyMutationInput["definition"]> {
    const current = await tx.dashboardWidget.findFirst({ where: { id, projectId } });
    if (!current) throw new DashboardWidgetNotFoundError();
    const parsed = dashboardWidgetDefinitionSchema.safeParse(current.definition);
    if (!parsed.success) {
      throw new DashboardWidgetDefinitionInvalidError(current.id, { reasons: [parsed.error] });
    }
    const definition = parsed.data;
    // An edit of code or queries keeps the other fields it was saved with.
    const description = input.description ?? definition.description;
    const prompt = input.prompt ?? definition.prompt;
    const source = input.source ?? definition.source;
    // null clears the stored list, so the widget follows its board again.
    const excludedOrigins =
      input.excludedOrigins === null
        ? undefined
        : (input.excludedOrigins ?? definition.excludedOrigins);
    return graphOf({
      code: input.code ?? definition.code,
      queries: input.queries ?? definition.queries,
      ...(description === undefined ? {} : { description }),
      ...(prompt === undefined ? {} : { prompt }),
      ...(source === undefined ? {} : { source }),
      ...(excludedOrigins === undefined ? {} : { excludedOrigins }),
    });
  }

  /**
   * Deletes a widget and its stale srcdoc copy, which carries the same id (AC199b).
   * @throws {DashboardWidgetNotFoundError} when nothing was deleted, so a
   *   caller cannot tell a foreign id from a gone one by the status.
   */
  async deleteWidget({ id, projectId }: { id: string; projectId: string }): Promise<void> {
    await this.transaction(async (tx) => {
      const result = await tx.dashboardWidget.deleteMany({ where: { id, projectId } });
      if (result.count === 0) throw new DashboardWidgetNotFoundError();
      await tx.customGraph.deleteMany({
        where: { id, projectId, kind: DASHBOARD_SRCDOC_CHART_KIND },
      });
    });
  }

  /**
   * Adds a widget to a dashboard at the next free row; row computation and
   * write share one transaction so concurrent assignments can't overlap.
   * @throws {DashboardNotFoundError} when the dashboard isn't this project's board (IDOR).
   * @throws {DashboardWidgetNotFoundError} when the widget isn't in this project (IDOR).
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
      if (!(await ownsBoard(tx, { dashboardId, projectId }))) {
        throw new DashboardNotFoundError(projectId);
      }
      // The next free row on the target board (gridRow is shared between the authoring grid
      // and the board's grid: accepted prototype coupling).
      const onDashboard = await tx.dashboardWidget.findMany({
        where: { projectId, dashboardId },
        select: { gridRow: true, rowSpan: true },
      });
      const result = await tx.dashboardWidget.updateMany({
        where: { id, projectId },
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

  /** One `updateMany` per widget in one transaction; a miss updates nothing. */
  async updateLayouts({ projectId, layouts }: DashboardWidgetLayoutsInput): Promise<void> {
    await this.transaction(async (tx) => {
      for (const { graphId, layout } of layouts) {
        await tx.dashboardWidget.updateMany({
          where: { id: graphId, projectId },
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

  #present(row: DashboardWidgetRecord): DashboardWidgetRow {
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      graph: row.definition,
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
