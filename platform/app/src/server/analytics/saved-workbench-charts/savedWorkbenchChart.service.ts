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
import { LWQL_QUERY_RESULT_DATASET } from "~/features/analytics-query/visualization/lwqlDatasetNames";
import { validateVegaLiteSpecStructure } from "~/features/analytics-query/visualization/validateVegaLiteSpec";
import type {
  CustomGraph,
  Prisma,
  PrismaClient,
} from "~/generated/prisma/client";

import type { Protections } from "../../traces/protections";
import { isUniqueConstraintError } from "../../utils/prismaErrors";
import type { LangWatchQLService } from "../lwql/lwql.service";
import {
  SavedWorkbenchChartAlreadyExistsError,
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
}

export interface SavedWorkbenchChartServiceDependencies {
  readonly repository: SavedWorkbenchChartStore;
  /**
   * Consulted for its verdict, never for rows. Validation needs no restricted
   * identity, so charts can be saved on a deployment that could not run them.
   */
  readonly lwql: LangWatchQLService;
}

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
  async getAll({
    projectId,
  }: {
    projectId: string;
  }): Promise<SavedWorkbenchChart[]> {
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
   * Deletes a saved chart.
   *
   * @throws {SavedWorkbenchChartNotFoundError} when no chart of this kind has
   *   that id in this project.
   */
  async deleteChart({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }): Promise<void> {
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
  if (error instanceof Error && error.name === "SavedWorkbenchChartDefinitionInvalidError") {
    throw new SavedWorkbenchChartDefinitionInvalidError(
      (error as Error & { chartId?: string }).chartId ?? "unknown",
    );
  }
  throw error;
}
