/**
 * Custom-chart-playground widgets — the write path the REST surface uses.
 *
 * A lean twin of {@link SavedWorkbenchChartService} for the playground's own
 * rows: `CustomGraph` records of kind {@link PLAYGROUND_SRCDOC_CHART_KIND},
 * whose `graph` column holds a {@link PlaygroundWidgetDefinition}
 * (`{ version, code, queries }`). Every read and write filters by that kind
 * alongside `projectId`, so a playground widget is never read, updated or
 * deleted through the builder or workbench paths — the same invariant the
 * `playgroundWidgets` tRPC router keeps for the UI.
 *
 * Deliberately thin: unlike the workbench chart service there is no LangWatchQL
 * or Vega-Lite governor to call, because a widget's queries are validated at
 * run time by `LW.query` inside the sandbox (see
 * {@link validatePlaygroundQueryParams}), not at save. The persistence shape is
 * the one the tRPC router already writes; this module exists so the REST route
 * that backs the `langwatch playground-widget` CLI has a single, kind-scoped
 * write path instead of reaching into Prisma from the handler.
 *
 * @see ../playgroundWidgetDefinition — the `graph` column's versioned shape
 * @see ../../api/routers/playgroundWidgets.ts — the UI's tRPC twin
 */

import { HandledError } from "@langwatch/handled-error";
import { nanoid } from "nanoid";

import type {
  CustomGraph,
  Prisma,
  PrismaClient,
} from "~/generated/prisma/client";
import { PLAYGROUND_SRCDOC_CHART_KIND } from "~/server/analytics/chartKinds";
import {
  PLAYGROUND_WIDGET_DEFINITION_VERSION,
  type PlaygroundQuery,
  type PlaygroundWidgetDefinition,
  playgroundWidgetDefinitionSchema,
} from "~/server/analytics/playgroundWidgetDefinition";

/**
 * No playground widget with that id in this project.
 *
 * A widget belonging to another project earns this too, and that is the point:
 * the answer must not let a caller tell "not yours" from "never existed" — the
 * same reasoning as {@link SavedWorkbenchChartNotFoundError}, applied to the
 * playground's id space.
 */
export class PlaygroundWidgetNotFoundError extends HandledError {
  declare readonly code: "playground_widget_not_found";

  constructor() {
    super("playground_widget_not_found", "Playground widget not found.", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "PlaygroundWidgetNotFoundError";
  }
}

/**
 * A stored definition does not match the versioned schema.
 *
 * `platform` fault and a 5xx on purpose: every write goes through a schema, so
 * a row that cannot be read back is something this application got wrong — a
 * hand-edited row, or a version skew a build shipped. Charging it to the
 * customer would file a real defect as routine noise.
 */
export class PlaygroundWidgetDefinitionInvalidError extends HandledError {
  declare readonly code: "playground_widget_definition_invalid";

  constructor(widgetId: string, options: { reasons?: readonly Error[] } = {}) {
    super(
      "playground_widget_definition_invalid",
      "This playground widget's definition could not be read.",
      {
        httpStatus: 500,
        fault: "platform",
        meta: { widgetId },
        ...options,
      },
    );
    this.name = "PlaygroundWidgetDefinitionInvalidError";
  }
}

/** A playground widget as every caller above this layer sees it. */
export interface PlaygroundWidget {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  /** Already parsed against the versioned schema — never raw `Json`. */
  readonly definition: PlaygroundWidgetDefinition;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** `null` when the widget is not on a dashboard — the playground page is not one. */
  readonly dashboardId: string | null;
  readonly gridColumn: number;
  readonly gridRow: number;
  readonly colSpan: number;
  readonly rowSpan: number;
}

/** The definition fields a create or update supplies. */
export interface PlaygroundWidgetDefinitionInput {
  readonly code: string;
  readonly queries: readonly PlaygroundQuery[];
}

const graphOf = (
  input: PlaygroundWidgetDefinitionInput,
): Prisma.InputJsonValue => ({
  version: PLAYGROUND_WIDGET_DEFINITION_VERSION,
  code: input.code,
  queries: input.queries as PlaygroundQuery[],
});

/**
 * Playground widgets — the only way the REST surface writes one.
 *
 * Constructed with a Prisma client rather than injected repositories: the
 * write path is direct and kind-scoped, and the prototype has no unit suite to
 * drive against an in-memory store. Mirror {@link SavedWorkbenchChartService}
 * if that changes.
 */
export class PlaygroundWidgetService {
  private constructor(private readonly prisma: PrismaClient) {}

  /** Builds the service with its production dependencies. */
  static create(prisma: PrismaClient): PlaygroundWidgetService {
    return new PlaygroundWidgetService(prisma);
  }

  /** Every playground widget in a project, ordered as the page shows them. */
  async getAll({
    projectId,
  }: {
    projectId: string;
  }): Promise<PlaygroundWidget[]> {
    const rows = await this.prisma.customGraph.findMany({
      where: { projectId, kind: PLAYGROUND_SRCDOC_CHART_KIND },
      orderBy: [{ gridRow: "asc" }, { gridColumn: "asc" }],
    });
    return rows.map((row) => this.present(row));
  }

  /**
   * One playground widget.
   *
   * @throws {PlaygroundWidgetNotFoundError} when no widget of this kind has
   *   that id in this project — including when it has that id in another one.
   */
  async getById({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }): Promise<PlaygroundWidget> {
    const row = await this.prisma.customGraph.findFirst({
      where: { id, projectId, kind: PLAYGROUND_SRCDOC_CHART_KIND },
    });
    if (!row) throw new PlaygroundWidgetNotFoundError();
    return this.present(row);
  }

  /** Saves a new widget below the project's lowest playground row. */
  async createWidget({
    projectId,
    input,
  }: {
    projectId: string;
    input: { name: string } & PlaygroundWidgetDefinitionInput;
  }): Promise<PlaygroundWidget> {
    const last = await this.prisma.customGraph.findFirst({
      where: { projectId, kind: PLAYGROUND_SRCDOC_CHART_KIND },
      orderBy: { gridRow: "desc" },
      select: { gridRow: true },
    });

    const row = await this.prisma.customGraph.create({
      data: {
        id: nanoid(),
        projectId,
        name: input.name,
        kind: PLAYGROUND_SRCDOC_CHART_KIND,
        graph: graphOf(input),
        gridColumn: 0,
        gridRow: last ? last.gridRow + 1 : 0,
        colSpan: 1,
        rowSpan: 1,
      },
    });
    return this.present(row);
  }

  /**
   * Updates a widget's name, its definition, or both, then returns it.
   *
   * @throws {PlaygroundWidgetNotFoundError} when the update touches no row —
   *   a missing id, or one in another project.
   */
  async updateWidget({
    id,
    projectId,
    input,
  }: {
    id: string;
    projectId: string;
    input: { name?: string } & Partial<PlaygroundWidgetDefinitionInput>;
  }): Promise<PlaygroundWidget> {
    const data: Prisma.CustomGraphUpdateManyMutationInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.code !== undefined && input.queries !== undefined) {
      data.graph = graphOf({ code: input.code, queries: input.queries });
    }

    const result = await this.prisma.customGraph.updateMany({
      where: { id, projectId, kind: PLAYGROUND_SRCDOC_CHART_KIND },
      data,
    });
    if (result.count === 0) throw new PlaygroundWidgetNotFoundError();
    return this.getById({ id, projectId });
  }

  /**
   * Deletes a widget.
   *
   * @throws {PlaygroundWidgetNotFoundError} when nothing was deleted, so a
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
      where: { id, projectId, kind: PLAYGROUND_SRCDOC_CHART_KIND },
    });
    if (result.count === 0) throw new PlaygroundWidgetNotFoundError();
  }

  /** Parses a row's `graph` against the versioned schema, loud on a bad row. */
  private present(row: CustomGraph): PlaygroundWidget {
    const parsed = playgroundWidgetDefinitionSchema.safeParse(row.graph);
    if (!parsed.success) {
      throw new PlaygroundWidgetDefinitionInvalidError(row.id, {
        reasons: [parsed.error],
      });
    }
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      definition: parsed.data,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      dashboardId: row.dashboardId,
      gridColumn: row.gridColumn,
      gridRow: row.gridRow,
      colSpan: row.colSpan,
      rowSpan: row.rowSpan,
    };
  }
}
