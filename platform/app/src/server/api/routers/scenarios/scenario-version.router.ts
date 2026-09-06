import { createLogger } from "@langwatch/observability";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { ScenarioNotFoundError } from "~/server/scenarios/errors";
import { ScenarioService } from "~/server/scenarios/scenario.service";
import { projectSchema } from "./schemas";

const logger = createLogger("langwatch:api:scenarios:versions");

/**
 * Turns the one plain-Error refusal into the tRPC shape; every handled error
 * (stale version, version not found) travels on unchanged so its code and
 * meta reach the client.
 */
const mapScenarioError = (error: unknown): never => {
  if (error instanceof ScenarioNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  throw error;
};

/**
 * Version history of a scenario: list, read one, restore one.
 *
 * @see specs/scenarios/scenario-versioning.feature
 * @see specs/scenarios/scenario-version-restore.feature
 */
export const scenarioVersionRouter = createTRPCRouter({
  listVersions: protectedProcedure
    .input(
      projectSchema.extend({
        scenarioId: z.string(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.number().int().optional(),
      }),
    )
    .permission("scenarios:view")
    .query(async ({ ctx, input }) => {
      const service = ScenarioService.create(ctx.prisma);
      const page = await service
        .listVersions({
          projectId: input.projectId,
          scenarioId: input.scenarioId,
          limit: input.limit,
          cursor: input.cursor,
        })
        .catch(mapScenarioError);

      // The history names the person who saved each version, and the service
      // stores only their id. Resolved here rather than in the service
      // because it is a display concern of this list.
      const authorIds = [
        ...new Set(
          page.versions
            .map((version) => version.authorId)
            .filter((id): id is string => !!id),
        ),
      ];
      const authors =
        authorIds.length > 0
          ? await ctx.prisma.user.findMany({
              where: { id: { in: authorIds } },
              select: { id: true, name: true },
            })
          : [];
      const nameById = new Map(
        authors.map((author) => [author.id, author.name]),
      );

      return {
        ...page,
        versions: page.versions.map((version) => ({
          ...version,
          authorName: version.authorId
            ? (nameById.get(version.authorId) ?? null)
            : null,
        })),
      };
    }),

  getVersion: protectedProcedure
    .input(
      projectSchema.extend({
        scenarioId: z.string(),
        version: z.number().int().min(1),
      }),
    )
    .permission("scenarios:view")
    .query(async ({ ctx, input }) => {
      const service = ScenarioService.create(ctx.prisma);
      return await service
        .getVersion({
          projectId: input.projectId,
          scenarioId: input.scenarioId,
          version: input.version,
        })
        .catch(mapScenarioError);
    }),

  restoreVersion: protectedProcedure
    .input(
      projectSchema.extend({
        scenarioId: z.string(),
        version: z.number().int().min(1),
      }),
    )
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      logger.info(
        {
          projectId: input.projectId,
          scenarioId: input.scenarioId,
          version: input.version,
        },
        "Restoring scenario version",
      );
      const service = ScenarioService.create(ctx.prisma);
      return await service
        .restoreVersion({
          projectId: input.projectId,
          scenarioId: input.scenarioId,
          version: input.version,
          actor: { userId: ctx.session.user.id, label: "user" },
        })
        .catch(mapScenarioError);
    }),
});
