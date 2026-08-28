/**
 * Saved workbench charts — the only way one is ever written.
 *
 * A saved chart is a query that will be run later, by whoever opens it, and a
 * specification that will be drawn over whatever that run returns. So the
 * governance that applies when a member presses Run has to apply again when
 * they press Save, or the database becomes the way around it: SQL nobody could
 * execute and specifications nobody could render would sit in rows waiting to
 * be handed to something that trusts them.
 *
 * Both governors are *called*, never re-implemented:
 *
 *  - the LangWatchQL validator, through `LangWatchQLService.validate` — the
 *    same decision `execute` makes, derived from the same catalog for the same
 *    caller's permissions, so what an author may read decides what their saved
 *    SQL may name;
 *  - the Vega-Lite policy, through `validateVegaLiteSpecStructure` — every rule
 *    that is a property of the specification itself.
 *
 * What is deliberately NOT decided here: whether the saved SQL returns rows
 * *this* viewer may see, and whether the specification's field references match
 * the columns a run produced. Both are facts about an execution, and this layer
 * holds a query rather than a result. They are re-evaluated per viewer at
 * render time, which is also what keeps a chart saved by a member with wider
 * protections from disclosing anything to one with narrower protections.
 *
 * @see specs/analytics/lwql-saved-charts.feature
 * @see ../lwql/lwql.service.ts — the other half of the gate
 */

import { ValidationError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  LWQL_QUERY_RESULT_DATASET,
  validateVegaLiteSpecStructure,
} from "@langwatch/analytics-web/validation";
import type { CustomGraph, Prisma, PrismaClient } from "~/generated/prisma/client";

import type { Protections } from "@langwatch/trace-server";
import { isUniqueConstraintError } from "../../utils/prismaErrors";
import type { LangWatchQLService } from "../lwql/lwql.service";
import {
  SavedWorkbenchChartAlreadyExistsError,
  SavedWorkbenchChartDashboardNotFoundError,
  SavedWorkbenchChartDefinitionInvalidError,
  SavedWorkbenchChartNotFoundError,
  SavedWorkbenchChartSpecificationRefusedError,
} from "./errors";
import {
  SavedWorkbenchChartRepository,
  type SavedWorkbenchChartStore,
} from "./savedWorkbenchChart.repository";
import {
  type WorkbenchChartDefinition,
  workbenchChartDefinitionSchema,
} from "./workbenchChartDefinition";

const logger = createLogger("langwatch:analytics:saved-workbench-charts");

/**
 * The identity fields a caller supplies alongside the definition. Bounded here
 * because {@link SavedWorkbenchChartService.LangWatchQL} speaks only for the
 * definition, this service is the sole write path, and Prisma is not a
 * validator.
 */
const chartNameSchema = z.string().trim().min(1).max(255);
const chartIdSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9_-]{1,64}$/,
    "id must be 1-64 characters of letters, digits, '_' or '-'",
  );

/** A saved chart as every caller above this layer sees it. */
export interface SavedWorkbenchChart {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  /** Already parsed against the versioned schema — never raw `Json`. */
  readonly definition: WorkbenchChartDefinition;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /**
   * `null` when the chart has never been placed, or has been unplaced.
   * `gridColumn`/`gridRow`/`colSpan`/`rowSpan` are meaningful only alongside a
   * non-null `dashboardId` — an unplaced chart's grid fields are the column's
   * defaults and are not a position on any dashboard.
   */
  readonly dashboardId: string | null;
  readonly gridColumn: number;
  readonly gridRow: number;
  readonly colSpan: number;
  readonly rowSpan: number;
}

export interface SavedWorkbenchChartServiceDependencies {
  readonly repository: SavedWorkbenchChartStore;
  /**
   * Consulted for its verdict, never for rows. Validation needs no restricted
   * identity, so charts can be saved on a deployment that could not run them.
   */
  readonly lwql: LangWatchQLService;
  /**
   * Answers whether a dashboard id belongs to a project. Injected rather than
   * called directly so a unit suite can drive `placeChart`'s tenancy refusal
   * against an in-memory answer instead of a real Prisma client — the same
   * reason `repository` is an interface rather than the Prisma repository
   * itself.
   *
   * @default the real {@link dashboardBelongsToProject}, bound to a Prisma
   *   client by {@link SavedWorkbenchChartService.create}.
   */
  readonly dashboardBelongsToProject: (input: {
    dashboardId: string;
    projectId: string;
  }) => Promise<boolean>;
  /**
   * The next free grid row on a dashboard, counting every chart on it
   * regardless of kind. Shared with `graphs.create` via
   * {@link allocateNextGridRow} so the two writers that can place a chart on
   * this grid never disagree about which row is free.
   *
   * @default the real {@link allocateNextGridRow}, bound to a Prisma client
   *   by {@link SavedWorkbenchChartService.create}.
   */
  readonly allocateNextGridRow: (input: {
    dashboardId: string;
    projectId: string;
  }) => Promise<number>;
}

/**
 * The ceiling a grid coordinate may carry. Far beyond any real dashboard, but
 * within Postgres's Int range — a larger value would overflow the column into
 * a generic 500 instead of this schema's named validation refusal.
 */
const MAX_GRID_COORDINATE = 2_000_000_000;

/** Grid bounds a chart may be placed with — the same 2-column grid the chart builder places onto. */
const placementSchema = z
  .object({
    dashboardId: z.string().min(1),
    gridColumn: z.number().int().min(0).max(1).optional(),
    gridRow: z.number().int().min(0).max(MAX_GRID_COORDINATE).optional(),
    colSpan: z.number().int().min(1).max(2).optional(),
    rowSpan: z.number().int().min(1).max(2).optional(),
  })
  // Each field's own bounds pass a column/span pair that still overflows the
  // grid — {gridColumn: 1, colSpan: 2} occupies columns 1 and 2, and column 2
  // does not exist. Checked together so that combination is refused here
  // rather than silently clipped or accepted by the placement it feeds.
  .refine(({ gridColumn = 0, colSpan = 1 }) => gridColumn + colSpan <= 2, {
    message: "gridColumn + colSpan must not exceed the 2-column grid",
    path: ["colSpan"],
  });

export class SavedWorkbenchChartService {
  constructor(private readonly deps: SavedWorkbenchChartServiceDependencies) {}

  /** Builds the compatibility service with explicit process-owned dependencies. */
  static create(
    prisma: PrismaClient,
    lwql: LangWatchQLService,
  ): SavedWorkbenchChartService {
    return new SavedWorkbenchChartService({
      repository: new SavedWorkbenchChartRepository(prisma),
      lwql,
    });
  }

  /**
   * Every saved workbench chart in a project.
   *
   * @throws {SavedWorkbenchChartDefinitionInvalidError} when any stored
   *   definition cannot be read. Loud rather than skipped: a short list that
   *   quietly omits a chart reads as "you have fewer charts than you do", and
   *   this can only happen when the application has stored something it cannot
   *   read back.
   */
  async getAll({ projectId }: { projectId: string }): Promise<SavedWorkbenchChart[]> {
    const rows = await this.deps.repository.findAll({ projectId });
    return rows.map((row) => this.present(row));
  }

  /**
   * One saved workbench chart.
   *
   * @throws {SavedWorkbenchChartNotFoundError} when no chart of this kind has
   *   that id in this project — including when it has that id in another one.
   */
  async getById({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }): Promise<SavedWorkbenchChart> {
    const row = await this.deps.repository.findById({ id, projectId });
    if (!row) throw new SavedWorkbenchChartNotFoundError();
    return this.present(row);
  }

  /**
   * Saves a new chart, once both governors have accepted its definition.
   *
   * Not an overload of the static factory: that one builds the service, this
   * one builds a chart.
   */
  async createChart({
    projectId,
    protections,
    input,
  }: {
    projectId: string;
    /** The author's content permissions, resolved server-side. */
    protections: Protections;
    input: {
      /** Optional client-provided id, so a UI can save optimistically. */
      id?: string;
      name: string;
      definition: unknown;
    };
  }): Promise<SavedWorkbenchChart> {
    const identity = z
      .object({ id: chartIdSchema.optional(), name: chartNameSchema })
      .safeParse({ id: input.id, name: input.name });
    if (!identity.success) throw ValidationError.fromZodError(identity.error);

    const definition = this.LangWatchQL({
      projectId,
      protections,
      definition: input.definition,
    });

    let row: CustomGraph;
    try {
      row = await this.deps.repository.create({
        id: identity.data.id ?? nanoid(),
        projectId,
        name: identity.data.name,
        definition: definition as Prisma.InputJsonValue,
      });
    } catch (error) {
      // The id is caller input, so a collision is theirs to act on rather
      // than an unknown 500.
      if (isUniqueConstraintError(error)) {
        throw new SavedWorkbenchChartAlreadyExistsError();
      }
      throw error;
    }

    logger.info(
      {
        projectId,
        chartId: row.id,
        hasSpecification: definition.vegaLiteSpec !== undefined,
      },
      "saved workbench chart created",
    );

    return this.present(row);
  }

  /**
   * Replaces a saved chart's name, its definition, or both.
   *
   * A definition offered here goes through exactly the governors a create goes
   * through — there is no edit path that skips them, which is the point of
   * routing both through {@link LangWatchQL}.
   *
   * @throws {SavedWorkbenchChartNotFoundError} when no chart of this kind has
   *   that id in this project.
   */
  async updateChart({
    id,
    projectId,
    protections,
    input,
  }: {
    id: string;
    projectId: string;
    protections: Protections;
    input: {
      name?: string;
      definition?: unknown;
    };
  }): Promise<SavedWorkbenchChart> {
    // Refuse before validating anything, so a member editing another project's
    // id learns only that it is not here.
    const existing = await this.deps.repository.findById({ id, projectId });
    if (!existing) throw new SavedWorkbenchChartNotFoundError();

    const identity = z
      .object({ name: chartNameSchema.optional() })
      .safeParse({ name: input.name });
    if (!identity.success) throw ValidationError.fromZodError(identity.error);

    const definition =
      input.definition === undefined
        ? undefined
        : this.LangWatchQL({
            projectId,
            protections,
            definition: input.definition,
          });

    const row = await this.deps.repository.update({
      id,
      projectId,
      ...(identity.data.name === undefined ? {} : { name: identity.data.name }),
      ...(definition === undefined
        ? {}
        : { definition: definition as Prisma.InputJsonValue }),
    });
    if (!row) throw new SavedWorkbenchChartNotFoundError();

    return this.present(row);
  }

  /**
   * Runs a saved chart: loads it through the one read path charts have and
   * executes its stored statement through the LangWatchQL gate, with the
   * surface's period and datapoint step supplied fresh by whoever is asking.
   *
   * It lives here rather than beside the ad-hoc query endpoint because the
   * chart — its stored values, its versioned definition — is this service's
   * fact, and the execution gate is a dependency it already holds; a second
   * runner would be a second place that knows what a chart becomes a run.
   *
   * The stored definition is re-parsed on the way in (via {@link getById}), so
   * a row this build can no longer read is refused by name rather than
   * executed. Validation is not repeated as a separate step because execution
   * validates first itself, against the caller's own current protections — a
   * member whose permissions narrowed after saving cannot run the chart into
   * columns they may no longer read.
   *
   * @throws {SavedWorkbenchChartNotFoundError} when no chart of this kind has
   *   that id in this project — another project's id included.
   * @throws the LangWatchQL gate's own handled errors: the validator's refusal,
   *   {@link LangWatchQLParameterMissingError} when the statement declares a
   *   reserved name the request supplies no value for (a declared granularity
   *   with no step among them), and
   *   {@link LangWatchQLGranularityTooFineError} when the period at the
   *   supplied step overflows the bucket ceiling and the caller asked to
   *   refuse, which is the default: a direct chart run is caller-owned, so it
   *   refuses where a dashboard widget passes `onBudgetOverflow: "coarsen"`
   *   and reads `coarsenedFromSeconds` off the result instead.
   */
  async runChart({
    id,
    projectId,
    project,
    protections,
    input,
  }: {
    id: string;
    projectId: string;
    /** The tenant the query runs for; its key never appears in the result. */
    project: LangWatchQLCaller;
    /** The runner's content permissions, resolved server-side for this request. */
    protections: Protections;
    input: {
      /** The period the surface is showing, when it has one. */
      timeWindow?: LangWatchQLTimeWindow;
      /** The step the surface chose, for a statement that declares the parameter. */
      granularitySeconds?: number;
      /**
       * What an overflowing period does to that step. Defaults to refusing;
       * only a surface whose period moves independently of the saved step
       * asks to coarsen.
       */
      onBudgetOverflow?: LangWatchQLBudgetOverflowMode;
    };
  }): Promise<LangWatchQLQueryResult> {
    const chart = await this.getById({ id, projectId });

    return this.deps.lwql.execute({
      project,
      protections,
      sql: chart.definition.sql,
      parameters: chart.definition.parameters,
      ...(input.timeWindow ? { timeWindow: input.timeWindow } : {}),
      ...(input.granularitySeconds !== undefined
        ? { granularitySeconds: input.granularitySeconds }
        : {}),
      ...(input.onBudgetOverflow
        ? { onBudgetOverflow: input.onBudgetOverflow }
        : {}),
    });
  }

  /**
   * Places a saved chart on a dashboard.
   *
   * `createChart` never places what it writes — this is the only way an
   * already-saved chart gains a `dashboardId` and a grid position, whether it
   * is being placed for the first time or moved from where it was.
   *
   * When no grid row is supplied, one is allocated the same way a builder
   * chart created with no explicit row is: the next row free on that
   * dashboard, counting charts of both kinds, through the shared
   * {@link SavedWorkbenchChartServiceDependencies.allocateNextGridRow}.
   *
   * @throws {SavedWorkbenchChartNotFoundError} when no chart of this kind has
   *   that id in this project.
   * @throws {SavedWorkbenchChartDashboardNotFoundError} when the dashboard id
   *   does not belong to this project — another project's dashboard included.
   *   Checked before anything is written, through the same
   *   {@link dashboardBelongsToProject} check dashboard-scoped chart creation
   *   already runs, so a foreign dashboard id is refused identically whether
   *   the chart being placed is new or already saved.
   */
  async placeChart({
    id,
    projectId,
    input,
  }: {
    id: string;
    projectId: string;
    input: {
      dashboardId: string;
      gridColumn?: number;
      gridRow?: number;
      colSpan?: number;
      rowSpan?: number;
    };
  }): Promise<SavedWorkbenchChart> {
    const parsed = placementSchema.safeParse(input);
    if (!parsed.success) throw ValidationError.fromZodError(parsed.error);

    // Refused before anything else is resolved, so a member placing onto
    // another project's dashboard learns only that it is not here — the same
    // shape of refusal `getById` already gives for a foreign chart id.
    const isDashboardInProject = await this.deps.dashboardBelongsToProject({
      dashboardId: parsed.data.dashboardId,
      projectId,
    });
    if (!isDashboardInProject)
      throw new SavedWorkbenchChartDashboardNotFoundError();

    const gridRow =
      parsed.data.gridRow ??
      (await this.deps.allocateNextGridRow({
        dashboardId: parsed.data.dashboardId,
        projectId,
      }));

    const row = await this.deps.repository.place({
      id,
      projectId,
      dashboardId: parsed.data.dashboardId,
      gridColumn: parsed.data.gridColumn ?? 0,
      gridRow,
      colSpan: parsed.data.colSpan ?? 1,
      rowSpan: parsed.data.rowSpan ?? 1,
    });
    if (!row) throw new SavedWorkbenchChartNotFoundError();

    return this.present(row);
  }

  /**
   * Removes a saved chart from whatever dashboard it is on.
   *
   * Idempotent: unplacing a chart that is already unplaced succeeds and
   * changes nothing, because the caller's intent — "this chart should not be
   * on a dashboard" — is already true.
   *
   * @throws {SavedWorkbenchChartNotFoundError} when no chart of this kind has
   *   that id in this project.
   */
  async unplaceChart({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }): Promise<SavedWorkbenchChart> {
    const row = await this.deps.repository.unplace({ id, projectId });
    if (!row) throw new SavedWorkbenchChartNotFoundError();
    return this.present(row);
  }

  /**
   * Deletes a saved chart.
   *
   * @throws {SavedWorkbenchChartNotFoundError} when no chart of this kind has
   *   that id in this project.
   */
  async deleteChart({ id, projectId }: { id: string; projectId: string }): Promise<void> {
    const deleted = await this.deps.repository.delete({ id, projectId });
    if (deleted === 0) throw new SavedWorkbenchChartNotFoundError();
  }

  /**
   * The gate. Everything written by this service passes through here.
   *
   * The first refusal wins rather than both being collected: each one is
   * complete on its own — the LangWatchQL validator reports every violation it
   * found, and the chart policy every rule it broke — and a member repairing
   * SQL is not helped by also being told about the specification.
   *
   * @throws {ValidationError} when the definition is not the shape a saved
   *   chart has, the LangWatchQL validator's own refusal when it will not admit
   *   the SQL, and {@link SavedWorkbenchChartSpecificationRefusedError} when
   *   the chart policy will not admit the specification.
   */
  private LangWatchQL({
    projectId,
    protections,
    definition,
  }: {
    projectId: string;
    protections: Protections;
    definition: unknown;
  }): WorkbenchChartDefinition {
    return validateSavedWorkbenchChartDefinition({
      projectId,
      protections,
      definition,
      lwql: this.deps.lwql,
    });
  }

  /**
   * Turns a stored row into the chart callers read.
   *
   * The stored definition is parsed rather than cast: `graph` is a `Json`
   * column and promises nothing, so trusting its shape is how a builder
   * payload or a row from a build that disagreed with this one would reach a
   * caller dressed as a workbench definition.
   */
  private present(row: CustomGraph): SavedWorkbenchChart {
    const parsed = workbenchChartDefinitionSchema.safeParse(row.graph);
    if (!parsed.success) {
      logger.error(
        { projectId: row.projectId, chartId: row.id },
        "stored workbench chart definition does not match the versioned schema",
      );
      throw new SavedWorkbenchChartDefinitionInvalidError(row.id, {
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

/**
 * Reuses Analytics' existing save-time governance without owning persistence.
 * Dashboard transports call this immediately before handing a parsed
 * definition to DashboardService, preserving caller-specific protections while
 * the lifecycle itself remains process-owned by Dashboard.
 */
export function validateSavedWorkbenchChartDefinition({
  projectId,
  protections,
  definition,
  lwql,
}: {
  projectId: string;
  protections: Protections;
  definition: unknown;
  lwql: LangWatchQLService;
}): WorkbenchChartDefinition {
  const parsed = workbenchChartDefinitionSchema.safeParse(definition);
  if (!parsed.success) throw ValidationError.fromZodError(parsed.error);

  lwql.validate({
    projectId,
    protections,
    sql: parsed.data.sql,
    parameters: parsed.data.parameters,
  });

  if (parsed.data.vegaLiteSpec !== undefined) {
    const verdict = validateVegaLiteSpecStructure({
      spec: parsed.data.vegaLiteSpec,
      registeredDatasets: [LWQL_QUERY_RESULT_DATASET],
    });
    if (!verdict.ok) {
      logger.info(
        {
          projectId,
          rules: verdict.errors.map((error) => error.rule),
        },
        "workbench chart specification refused by policy",
      );
      throw new SavedWorkbenchChartSpecificationRefusedError(verdict.errors);
    }
  }

  return parsed.data;
}

/** Keeps compatibility transports on the established handled-error wire shape. */
export function mapDashboardSavedWorkbenchChartError(error: unknown): never {
  if (error instanceof Error && error.name === "SavedWorkbenchChartNotFoundError") {
    throw new SavedWorkbenchChartNotFoundError();
  }
  if (
    error instanceof Error &&
    error.name === "SavedWorkbenchChartDefinitionInvalidError"
  ) {
    throw new SavedWorkbenchChartDefinitionInvalidError(
      (error as Error & { chartId?: string }).chartId ?? "unknown",
    );
  }
  throw error;
}
