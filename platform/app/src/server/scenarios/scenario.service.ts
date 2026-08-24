import { createLogger } from "@langwatch/observability";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { PrismaClient, Scenario } from "~/generated/prisma/client";
import {
  assertAssignableFolder,
  reconcileFolderMembership,
} from "../suites/folder-membership";
import { ScenarioNotFoundError } from "./errors";
import {
  type CreateScenarioInput,
  ScenarioRepository,
  type ScenarioRunConfig,
  type UpdateScenarioInput,
} from "./scenario.repository";

const tracer = getLangWatchTracer("langwatch.scenarios.service");
const logger = createLogger("langwatch:scenarios:service");

export class ScenarioService {
  constructor(
    private readonly repository: ScenarioRepository,
    private readonly prisma: PrismaClient,
  ) {}

  static create(prisma: PrismaClient): ScenarioService {
    return new ScenarioService(new ScenarioRepository(prisma), prisma);
  }

  async create(input: CreateScenarioInput): Promise<Scenario> {
    return tracer.withActiveSpan(
      "ScenarioService.create",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": input.projectId,
        },
      },
      async (span) => {
        logger.debug({ projectId: input.projectId }, "Creating scenario");
        const folderId = input.folderId ?? null;
        const result = folderId
          ? await this.prisma.$transaction(async (tx) => {
              await assertAssignableFolder({
                projectId: input.projectId,
                folderId,
                tx,
              });
              const created = await this.repository.create(input, tx);
              await reconcileFolderMembership({
                projectId: input.projectId,
                folderId,
                tx,
              });
              return created;
            })
          : await this.repository.create(input);
        span.setAttribute("scenario.id", result.id);
        return result;
      },
    );
  }

  async getById(params: {
    id: string;
    projectId: string;
  }): Promise<Scenario | null> {
    return tracer.withActiveSpan(
      "ScenarioService.getById",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "scenario.id": params.id,
        },
      },
      async (span) => {
        logger.debug(
          { projectId: params.projectId, scenarioId: params.id },
          "Fetching scenario by id",
        );
        const result = await this.repository.findById(params);
        span.setAttribute("result.found", result !== null);
        return result;
      },
    );
  }

  /**
   * Fetch a scenario by ID regardless of its archived status.
   * Used for viewing run results of scenarios that may have been archived.
   */
  async getByIdIncludingArchived(params: {
    id: string;
    projectId: string;
  }): Promise<Scenario | null> {
    return tracer.withActiveSpan(
      "ScenarioService.getByIdIncludingArchived",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "scenario.id": params.id,
        },
      },
      async (span) => {
        logger.debug(
          { projectId: params.projectId, scenarioId: params.id },
          "Fetching scenario by id including archived",
        );
        const result = await this.repository.findByIdIncludingArchived(params);
        span.setAttribute("result.found", result !== null);
        return result;
      },
    );
  }

  /**
   * Fetch what a run needs off each scenario before it schedules anything:
   * the name, the declared parameters, and the text they render into.
   */
  async getRunConfigByIds(params: {
    ids: string[];
    projectId: string;
  }): Promise<ScenarioRunConfig[]> {
    return tracer.withActiveSpan(
      "ScenarioService.getRunConfigByIds",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "scenario.count": params.ids.length,
        },
      },
      async () => this.repository.findRunConfigByIds(params),
    );
  }

  async getAll(params: { projectId: string }): Promise<Scenario[]> {
    return tracer.withActiveSpan(
      "ScenarioService.getAll",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
        },
      },
      async (span) => {
        logger.debug({ projectId: params.projectId }, "Fetching all scenarios");
        const result = await this.repository.findAll(params);
        span.setAttribute("result.count", result.length);
        return result;
      },
    );
  }

  async update(
    id: string,
    projectId: string,
    data: UpdateScenarioInput,
  ): Promise<Scenario> {
    return tracer.withActiveSpan(
      "ScenarioService.update",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": projectId,
          "scenario.id": id,
        },
      },
      async () => {
        logger.debug({ projectId, scenarioId: id }, "Updating scenario");
        if (data.folderId === undefined) {
          return await this.repository.update(id, projectId, data);
        }
        // The update changes folder membership: validate the destination and
        // recompute both folders' member lists in the same transaction, so a
        // write that fails part way leaves both sides untouched.
        const nextFolderId = data.folderId;
        return await this.prisma.$transaction(async (tx) => {
          const existing = await tx.scenario.findFirst({
            where: { id, projectId, archivedAt: null },
            select: { folderId: true },
          });
          if (!existing) {
            throw new ScenarioNotFoundError();
          }
          if (nextFolderId) {
            await assertAssignableFolder({
              projectId,
              folderId: nextFolderId,
              tx,
            });
          }
          const updated = await this.repository.update(id, projectId, data, tx);
          const touchedFolderIds = new Set(
            [existing.folderId, nextFolderId].filter(
              (folderId): folderId is string => !!folderId,
            ),
          );
          for (const folderId of touchedFolderIds) {
            await reconcileFolderMembership({ projectId, folderId, tx });
          }
          return updated;
        });
      },
    );
  }

  /**
   * Files a scenario into a folder, or unfiles it with folderId null.
   * The scenario keeps everything else, run history included.
   */
  async moveToFolder(params: {
    scenarioId: string;
    projectId: string;
    folderId: string | null;
  }): Promise<Scenario> {
    return tracer.withActiveSpan(
      "ScenarioService.moveToFolder",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "scenario.id": params.scenarioId,
        },
      },
      async () =>
        this.update(params.scenarioId, params.projectId, {
          folderId: params.folderId,
        }),
    );
  }

  /**
   * Copies a scenario's definition and folder membership into a new scenario
   * named "<name> (copy)". Run history stays with the original.
   */
  async duplicate(params: {
    scenarioId: string;
    projectId: string;
    lastUpdatedById?: string;
  }): Promise<Scenario> {
    return tracer.withActiveSpan(
      "ScenarioService.duplicate",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "scenario.id": params.scenarioId,
        },
      },
      async (span) => {
        const original = await this.repository.findById({
          id: params.scenarioId,
          projectId: params.projectId,
        });
        if (!original) {
          throw new ScenarioNotFoundError();
        }
        // Goes through create so everything create does for a new scenario
        // (folder reconciliation now, version rows once scenarios version)
        // covers duplicates too.
        const copy = await this.create({
          projectId: original.projectId,
          name: `${original.name} (copy)`,
          situation: original.situation,
          criteria: original.criteria,
          labels: original.labels,
          parameters: original.parameters ?? undefined,
          simulatorModel: original.simulatorModel,
          judgeModel: original.judgeModel,
          maxTurns: original.maxTurns,
          minTurns: original.minTurns,
          folderId: original.folderId,
          lastUpdatedById: params.lastUpdatedById ?? null,
        });
        span.setAttribute("scenario.duplicated_id", copy.id);
        return copy;
      },
    );
  }

  /**
   * Soft-archive a single scenario.
   * Throws if the scenario is not found in the given project.
   */
  async archive(params: { id: string; projectId: string }): Promise<Scenario> {
    return tracer.withActiveSpan(
      "ScenarioService.archive",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "scenario.id": params.id,
        },
      },
      async () => {
        logger.debug(
          { projectId: params.projectId, scenarioId: params.id },
          "Archiving scenario",
        );
        const result = await this.prisma.$transaction(async (tx) => {
          const archived = await this.repository.archive({ ...params, tx });
          if (archived?.folderId) {
            // An archived scenario keeps its folderId for a later restore,
            // but leaves the folder's active member list.
            await reconcileFolderMembership({
              projectId: params.projectId,
              folderId: archived.folderId,
              tx,
            });
          }
          return archived;
        });
        if (!result) {
          throw new ScenarioNotFoundError();
        }
        return result;
      },
    );
  }

  /**
   * Soft-archive multiple scenarios.
   * Returns archived IDs and structured failure details.
   */
  async batchArchive(params: { ids: string[]; projectId: string }): Promise<{
    archived: string[];
    failed: { id: string; error: string }[];
  }> {
    return tracer.withActiveSpan(
      "ScenarioService.batchArchive",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "scenario.count": params.ids.length,
        },
      },
      async (span) => {
        logger.debug(
          { projectId: params.projectId, count: params.ids.length },
          "Batch archiving scenarios",
        );

        // Existence is resolved up front so the transaction below archives
        // only rows that exist: missing ids come back as per-id failures, and
        // the found ones archive together with ONE membership recompute per
        // touched folder rather than one per scenario.
        const rows = await this.repository.findManyIncludingArchived({
          ids: params.ids,
          projectId: params.projectId,
        });
        const rowsById = new Map(rows.map((row) => [row.id, row]));
        const found = params.ids.filter((id) => rowsById.has(id));
        const failed = params.ids
          .filter((id) => !rowsById.has(id))
          .map((id) => ({ id, error: "Not found" }));

        if (found.length > 0) {
          await this.prisma.$transaction(async (tx) => {
            for (const id of found) {
              await this.repository.archive({
                id,
                projectId: params.projectId,
                tx,
              });
            }
            const touchedFolderIds = new Set(
              found
                .map((id) => rowsById.get(id)?.folderId)
                .filter((folderId): folderId is string => !!folderId),
            );
            for (const folderId of touchedFolderIds) {
              await reconcileFolderMembership({
                projectId: params.projectId,
                folderId,
                tx,
              });
            }
          });
        }

        span.setAttribute("result.archived", found.length);
        span.setAttribute("result.failed", failed.length);
        return { archived: found, failed };
      },
    );
  }
}
