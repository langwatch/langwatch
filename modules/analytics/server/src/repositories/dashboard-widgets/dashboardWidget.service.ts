/**
 * A lean twin of {@link SavedWorkbenchChartService}, kind-scoped by
 * {@link DASHBOARD_SRCDOC_CHART_KIND} + `projectId` so a widget is never
 * touched through the builder or workbench paths (see ../dashboardWidgetDefinition).
 */

import { HandledError } from "@langwatch/handled-error";
import { fromDate, type Instant } from "@langwatch/time";
import { nanoid } from "nanoid";

import type {
  CustomGraph,
  Prisma,
  PrismaClient,
} from "@langwatch/prisma-client/generated";
import {
  CHART_GRID_DEFAULT_COL_SPAN,
  CHART_GRID_DEFAULT_ROW_SPAN,
  chartGridBottomRow,
} from "../chartGrid.ts";
import { DASHBOARD_SRCDOC_CHART_KIND } from "@langwatch/analytics-contract";
import { dashboardBelongsToProject } from "./dashboardBelongsToProject.ts";
import {
  DASHBOARD_WIDGET_DEFINITION_VERSION,
  type DashboardWidgetDefinition,
  type DashboardWidgetQuery,
  dashboardWidgetDefinitionSchema,
} from "../dashboardWidgetDefinition.ts";

/**
 * A widget in another project earns this too, on purpose: the answer must
 * not let a caller tell "not yours" from "never existed" — same reasoning
 * as {@link SavedWorkbenchChartNotFoundError}, applied to this id space.
 */
export class DashboardWidgetNotFoundError extends HandledError {
  declare readonly code: "dashboard_widget_not_found";

  constructor() {
    super("dashboard_widget_not_found", "Dashboard widget not found.", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "DashboardWidgetNotFoundError";
  }
}

/**
 * `platform` fault and a 5xx on purpose: every write goes through a schema,
 * so an unreadable row is something this application got wrong. Charging
 * it to the customer would file a real defect as routine noise.
 */
export class DashboardWidgetDefinitionInvalidError extends HandledError {
  declare readonly code: "dashboard_widget_definition_invalid";

  constructor(widgetId: string, options: { reasons?: readonly Error[] } = {}) {
    super(
      "dashboard_widget_definition_invalid",
      "This dashboard widget's definition could not be read.",
      {
        httpStatus: 500,
        fault: "platform",
        meta: { widgetId },
        ...options,
      },
    );
    this.name = "DashboardWidgetDefinitionInvalidError";
  }
}

/** A dashboard widget as every caller above this layer sees it. */
export interface DashboardWidget {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  /** Already parsed against the versioned schema — never raw `Json`. */
  readonly definition: DashboardWidgetDefinition;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
  /** `null` when the widget is not on a dashboard — the playground page is not one. */
  readonly dashboardId: string | null;
  readonly gridColumn: number;
  readonly gridRow: number;
  readonly colSpan: number;
  readonly rowSpan: number;
}

/** The definition fields a create or update supplies. */
export interface DashboardWidgetDefinitionInput {
  readonly code: string;
  readonly queries: readonly DashboardWidgetQuery[];
}

const graphOf = (
  input: DashboardWidgetDefinitionInput,
): Prisma.InputJsonValue => ({
  version: DASHBOARD_WIDGET_DEFINITION_VERSION,
  code: input.code,
  queries: input.queries as DashboardWidgetQuery[],
});

/**
 * Constructed with a Prisma client rather than injected repositories: the
 * write path is direct and kind-scoped, and the prototype has no unit
 * suite to drive against an in-memory store.
 */
export class DashboardWidgetService {
  private constructor(private readonly prisma: PrismaClient) {}

  /** Builds the service with its production dependencies. */
  static create(prisma: PrismaClient): DashboardWidgetService {
    return new DashboardWidgetService(prisma);
  }

  /** Every dashboard widget in a project, ordered as the page shows them. */
  async getAll({
    projectId,
  }: {
    projectId: string;
  }): Promise<DashboardWidget[]> {
    const rows = await this.prisma.customGraph.findMany({
      where: { projectId, kind: DASHBOARD_SRCDOC_CHART_KIND },
      orderBy: [{ gridRow: "asc" }, { gridColumn: "asc" }],
    });
    return rows.map((row) => this.present(row));
  }

  /**
   * One dashboard widget.
   * @throws {DashboardWidgetNotFoundError} when no widget of this kind has
   *   that id in this project — including when it has that id in another one.
   */
  async getById({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }): Promise<DashboardWidget> {
    const row = await this.prisma.customGraph.findFirst({
      where: { id, projectId, kind: DASHBOARD_SRCDOC_CHART_KIND },
    });
    if (!row) throw new DashboardWidgetNotFoundError();
    return this.present(row);
  }

  /**
   * Saves a new widget below the lowest row it would collide with; row
   * computation and write share one transaction so concurrent creates can't race.
   * @throws {DashboardWidgetNotFoundError} when `dashboardId` names no dashboard here (IDOR).
   */
  async createWidget({
    projectId,
    dashboardId,
    input,
  }: {
    projectId: string;
    /** When placing on a dashboard; absent for the unplaced authoring grid. */
    dashboardId?: string;
    input: { name: string } & DashboardWidgetDefinitionInput;
  }): Promise<DashboardWidget> {
    const row = await this.prisma.$transaction(async (tx) => {
      if (
        dashboardId !== undefined &&
        !(await dashboardBelongsToProject(tx, dashboardId, projectId))
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
          id: nanoid(),
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
    return this.present(row);
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
  }): Promise<DashboardWidget> {
    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.CustomGraphUpdateManyMutationInput = {};
      if (input.name !== undefined) data.name = input.name;

      if (input.code !== undefined || input.queries !== undefined) {
        data.graph = await this.mergeDefinitionUpdate({
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
  private async mergeDefinitionUpdate({
    tx,
    id,
    projectId,
    input,
  }: {
    tx: Prisma.TransactionClient;
    id: string;
    projectId: string;
    input: Partial<DashboardWidgetDefinitionInput>;
  }): Promise<Prisma.CustomGraphUpdateManyMutationInput["graph"]> {
    const current = await tx.customGraph.findFirst({
      where: { id, projectId, kind: DASHBOARD_SRCDOC_CHART_KIND },
    });
    if (!current) throw new DashboardWidgetNotFoundError();
    const { definition } = this.present(current);
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
  async deleteWidget({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }): Promise<void> {
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
  }): Promise<DashboardWidget> {
    await this.prisma.$transaction(async (tx) => {
      if (!(await dashboardBelongsToProject(tx, dashboardId, projectId))) {
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

  /** Parses a row's `graph` against the versioned schema, loud on a bad row. */
  private present(row: CustomGraph): DashboardWidget {
    const parsed = dashboardWidgetDefinitionSchema.safeParse(row.graph);
    if (!parsed.success) {
      throw new DashboardWidgetDefinitionInvalidError(row.id, {
        reasons: [parsed.error],
      });
    }
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      definition: parsed.data,
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
