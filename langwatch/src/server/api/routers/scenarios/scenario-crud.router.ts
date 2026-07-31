import { createLogger } from "@langwatch/observability";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { fireScenarioCreatedNurturing } from "~/../ee/billing/nurturing/hooks/featureAdoption";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { enforceLicenseLimit } from "~/server/license-enforcement";
import { trackServerEvent } from "~/server/posthog";
import { ScenarioNotFoundError } from "~/server/scenarios/errors";
import type { RedTeamConfig } from "~/server/scenarios/execution/types";
import {
  mergeRedTeamState,
  normalizeRedTeamWrite,
  redTeamFields,
  redTeamStateIssue,
  touchesRedTeam,
} from "~/server/scenarios/red-team-input";
import { toPrismaRedTeamConfig } from "~/server/scenarios/red-team-prisma";
import { ScenarioService } from "~/server/scenarios/scenario.service";
import { captureException } from "~/utils/posthogErrorCapture";
import { checkProjectPermission } from "../../rbac";
import { projectSchema } from "./schemas";

const logger = createLogger("langwatch:api:scenarios:crud");

/**
 * Optional adversarial configuration. A red-team scenario needs both a
 * strategy and an objective; the objective is what the attacker is trying to
 * make the agent do, so a strategy without one has nothing to pursue.
 */
const createScenarioSchema = projectSchema.extend({
  name: z.string().min(1),
  situation: z.string(),
  criteria: z.array(z.string()).default([]),
  labels: z.array(z.string()).default([]),
  // Optional per-scenario model overrides; null clears back to the project
  // default (scenarios.user_simulator / scenarios.judge).
  simulatorModel: z.string().nullish(),
  judgeModel: z.string().nullish(),
  ...redTeamFields,
});

const updateScenarioSchema = projectSchema.extend({
  id: z.string(),
  name: z.string().min(1).optional(),
  situation: z.string().optional(),
  criteria: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
  simulatorModel: z.string().nullish(),
  judgeModel: z.string().nullish(),
  ...redTeamFields,
});

/**
 * Scenario CRUD operations.
 */
export const scenarioCrudRouter = createTRPCRouter({
  create: protectedProcedure
    .input(createScenarioSchema)
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input: rawInput }) => {
      logger.info({ projectId: rawInput.projectId }, "Creating scenario");

      // Enforce scenario limit before creation
      await enforceLicenseLimit(ctx, rawInput.projectId, "scenarios");

      const input = normalizeRedTeamWrite(rawInput);
      const createIssue = redTeamStateIssue(input);
      if (createIssue) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: createIssue.message,
        });
      }

      const { redTeamConfig, ...rest } = input;
      const service = ScenarioService.create(ctx.prisma);
      const result = await service.create({
        ...rest,
        ...toPrismaRedTeamConfig(redTeamConfig),
        lastUpdatedById: ctx.session.user.id,
      });

      trackServerEvent({
        userId: ctx.session.user.id,
        event: "scenario_created",
        projectId: input.projectId,
      });

      void ctx.prisma.scenario
        .count({
          where: { projectId: input.projectId, archivedAt: null },
        })
        .then((count) => {
          fireScenarioCreatedNurturing({
            userId: ctx.session.user.id,
            scenarioCount: count,
            scenarioId: result.id,
            projectId: input.projectId,
          });
        })
        .catch(captureException);

      logger.info(
        { projectId: input.projectId, scenarioId: result.id },
        "Scenario created",
      );
      return result;
    }),

  getAll: protectedProcedure
    .input(projectSchema)
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ ctx, input }) => {
      logger.debug({ projectId: input.projectId }, "Fetching all scenarios");
      const service = ScenarioService.create(ctx.prisma);
      return service.getAll(input);
    }),

  getById: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ ctx, input }) => {
      logger.debug(
        { projectId: input.projectId, scenarioId: input.id },
        "Fetching scenario by id",
      );
      const service = ScenarioService.create(ctx.prisma);
      const scenario = await service.getById(input);
      if (!scenario) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Scenario not found",
        });
      }
      return scenario;
    }),

  getByIdIncludingArchived: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ ctx, input }) => {
      logger.debug(
        { projectId: input.projectId, scenarioId: input.id },
        "Fetching scenario by id including archived",
      );
      const service = ScenarioService.create(ctx.prisma);
      return service.getByIdIncludingArchived(input);
    }),

  update: protectedProcedure
    .input(updateScenarioSchema)
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input: rawInput }) => {
      logger.info(
        { projectId: rawInput.projectId, scenarioId: rawInput.id },
        "Updating scenario",
      );

      const input = normalizeRedTeamWrite(rawInput);
      const { id, projectId, redTeamConfig, ...data } = input;
      const service = ScenarioService.create(ctx.prisma);

      // Only read the stored row when the write actually mentions the attack:
      // merging is needed so a partial update is not rejected for a field it
      // never sent, but a rename should not pay for a round trip to find that
      // out.
      if (touchesRedTeam(input)) {
        const existing = await service.getById({ id, projectId });
        // A missing row is a missing row. Merging against nothing produces an
        // all-undefined state, and the pairing check would answer for it —
        // reporting "needs an attack objective" for a scenario that does not
        // exist, which sends the caller looking for the wrong bug.
        if (!existing) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Scenario not found",
          });
        }
        const updateIssue = redTeamStateIssue(
          mergeRedTeamState(input, {
            redTeamStrategy: existing.redTeamStrategy,
            redTeamTarget: existing.redTeamTarget,
            redTeamTotalTurns: existing.redTeamTotalTurns,
            redTeamConfig: existing.redTeamConfig as RedTeamConfig | null,
          }),
        );
        if (updateIssue) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: updateIssue.message,
          });
        }
      }
      const result = await service.update(id, projectId, {
        ...data,
        ...toPrismaRedTeamConfig(redTeamConfig),
        lastUpdatedById: ctx.session.user.id,
      });

      logger.info({ projectId, scenarioId: id }, "Scenario updated");
      return result;
    }),

  archive: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input }) => {
      logger.info(
        { projectId: input.projectId, scenarioId: input.id },
        "Archiving scenario",
      );

      const service = ScenarioService.create(ctx.prisma);
      try {
        const result = await service.archive(input);
        logger.info(
          { projectId: input.projectId, scenarioId: input.id },
          "Scenario archived",
        );
        return result;
      } catch (error) {
        if (error instanceof ScenarioNotFoundError) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: error.message,
          });
        }
        throw error;
      }
    }),

  batchArchive: protectedProcedure
    .input(projectSchema.extend({ ids: z.array(z.string()).min(1) }))
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input }) => {
      logger.info(
        { projectId: input.projectId, count: input.ids.length },
        "Batch archiving scenarios",
      );

      const service = ScenarioService.create(ctx.prisma);
      const result = await service.batchArchive(input);

      logger.info(
        {
          projectId: input.projectId,
          archived: result.archived.length,
          failed: result.failed.length,
        },
        "Batch archive complete",
      );
      return result;
    }),
});
