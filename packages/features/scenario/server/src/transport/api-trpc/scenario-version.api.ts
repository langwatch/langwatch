/**
 * Version history of a scenario over the process's tRPC transport: list, read
 * one, restore one.
 *
 * @see specs/scenarios/scenario-versioning.feature
 * @see specs/scenarios/scenario-version-restore.feature
 */
import { createLogger } from "@langwatch/observability";
import { ScenarioNotFoundError } from "@langwatch/scenario-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";
import { projectSchema } from "./scenario.schemas";
import type { ScenarioTrpcContext, ScenarioTrpcProcedures } from "./scenario.trpc-context";

const logger = createLogger("langwatch:api:scenarios:versions");

/**
 * Turns the one plain-Error refusal into the tRPC shape; every handled error
 * (stale version, version not found) travels on unchanged so its code and
 * meta reach the client.
 */
const mapScenarioError = (error: unknown): never => {
  if (error instanceof ScenarioNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Scenario not found" });
  }
  throw error;
};

export function createScenarioVersionRouter<
  TContext extends ScenarioTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(
  trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
  procedures: ScenarioTrpcProcedures<TContext, TOptions, TRoot>,
) {
  const { protected: procedure, policy } = procedures;

  return trpc.router({
    listVersions: policy("scenarios:view")(
      procedure.input(
        projectSchema.extend({
          scenarioId: z.string(),
          limit: z.number().int().min(1).max(100).optional(),
          cursor: z.number().int().optional(),
        }),
      ),
    ).query(async ({ ctx, input }) => {
      const page = await ctx.app.scenarios
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
          page.versions.map((version) => version.authorId).filter((id): id is string => !!id),
        ),
      ];
      const authors =
        authorIds.length > 0 ? await ctx.app.scenarios.getUserProfiles({ userIds: authorIds }) : [];
      const nameById = new Map(authors.map((author) => [author.id, author.name]));

      return {
        ...page,
        versions: page.versions.map((version) => ({
          ...version,
          authorName: version.authorId ? (nameById.get(version.authorId) ?? null) : null,
        })),
      };
    }),

    getVersion: policy("scenarios:view")(
      procedure.input(
        projectSchema.extend({
          scenarioId: z.string(),
          version: z.number().int().min(1),
        }),
      ),
    ).query(async ({ ctx, input }) => {
      return await ctx.app.scenarios
        .getVersion({
          projectId: input.projectId,
          scenarioId: input.scenarioId,
          version: input.version,
        })
        .catch(mapScenarioError);
    }),

    restoreVersion: policy("scenarios:manage")(
      procedure.input(
        projectSchema.extend({
          scenarioId: z.string(),
          version: z.number().int().min(1),
        }),
      ),
    ).mutation(async ({ ctx, input }) => {
      logger.info(
        {
          projectId: input.projectId,
          scenarioId: input.scenarioId,
          version: input.version,
        },
        "Restoring scenario version",
      );
      return await ctx.app.scenarios
        .restoreVersion(
          {
            projectId: input.projectId,
            scenarioId: input.scenarioId,
            version: input.version,
          },
          ctx.actor(),
        )
        .catch(mapScenarioError);
    }),
  });
}
