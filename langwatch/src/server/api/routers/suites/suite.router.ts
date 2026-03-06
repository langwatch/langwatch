/**
 * tRPC router for simulation suite configurations.
 *
 * Provides CRUD, duplicate, archive, and run endpoints.
 */

import { TRPCError } from "@trpc/server";
import { on } from "node:events";
import { z } from "zod";
import { getApp } from "~/server/app-layer/app";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { SuiteService } from "~/server/suites/suite.service";
import { SuiteRunService } from "~/server/suites/suite-run.service";
import { SuiteRunReadRepositoryClickHouse } from "~/server/suites/repositories/suiteRunRead.clickhouse.repository";
import { SuiteDomainError } from "~/server/suites/errors";
import { ProjectRepository } from "~/server/projects/project.repository";
import { getClickHouseClient } from "~/server/clickhouse/client";
import { checkProjectPermission } from "../../rbac";
import { createSuiteSchema, projectSchema, suiteTargetSchema, updateSuiteSchema } from "./schemas";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:api:suites");

function createSuiteRunService(): SuiteRunService {
  const clickhouse = getClickHouseClient();
  if (!clickhouse) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "ClickHouse is not configured",
    });
  }
  return new SuiteRunService(new SuiteRunReadRepositoryClickHouse(clickhouse));
}

export const suiteRouter = createTRPCRouter({
  create: protectedProcedure
    .input(createSuiteSchema)
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = SuiteService.create(ctx.prisma);
      return service.create(input);
    }),

  getAll: protectedProcedure
    .input(projectSchema)
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ ctx, input }) => {
      const service = SuiteService.create(ctx.prisma);
      return service.getAll(input);
    }),

  getById: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ ctx, input }) => {
      const service = SuiteService.create(ctx.prisma);
      const suite = await service.getById(input);
      if (!suite) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Suite not found",
        });
      }
      return suite;
    }),

  update: protectedProcedure
    .input(updateSuiteSchema)
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input }) => {
      const { id, projectId, ...data } = input;
      const service = SuiteService.create(ctx.prisma);
      return service.update({ id, projectId, data });
    }),

  duplicate: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = SuiteService.create(ctx.prisma);
      try {
        return await service.duplicate(input);
      } catch (error) {
        if (error instanceof SuiteDomainError) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: error.message,
          });
        }
        throw error;
      }
    }),

  archive: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = SuiteService.create(ctx.prisma);
      const result = await service.archive(input);
      if (!result) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Suite not found",
        });
      }
      return result;
    }),

  getQueueStatus: protectedProcedure
    .input(projectSchema.extend({ suiteId: z.string() }))
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ ctx, input }) => {
      // Verify suite belongs to the authorized project
      const service = SuiteService.create(ctx.prisma);
      const suite = await service.getById({
        id: input.suiteId,
        projectId: input.projectId,
      });
      if (!suite) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Suite not found",
        });
      }
      return SuiteService.getQueueStatus({ suiteId: input.suiteId });
    }),

  getRunState: protectedProcedure
    .input(projectSchema.extend({
      suiteId: z.string(),
      batchRunId: z.string(),
    }))
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input }) => {
      const service = createSuiteRunService();
      return service.getSuiteRunState({
        suiteId: input.suiteId,
        batchRunId: input.batchRunId,
        tenantId: input.projectId,
      });
    }),

  getRunHistory: protectedProcedure
    .input(projectSchema.extend({
      suiteId: z.string(),
      limit: z.number().min(1).max(100).default(20),
      cursor: z.string().optional(),
    }))
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input }) => {
      const service = createSuiteRunService();
      return service.getSuiteRunHistory({
        suiteId: input.suiteId,
        tenantId: input.projectId,
        limit: input.limit,
        cursor: input.cursor,
      });
    }),

  getRunItems: protectedProcedure
    .input(projectSchema.extend({
      suiteId: z.string(),
      batchRunId: z.string(),
    }))
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input }) => {
      const service = createSuiteRunService();
      return service.getRunItems({
        suiteId: input.suiteId,
        batchRunId: input.batchRunId,
        tenantId: input.projectId,
      });
    }),

  getRunByIdempotencyKey: protectedProcedure
    .input(projectSchema.extend({
      idempotencyKey: z.string(),
    }))
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input }) => {
      const service = createSuiteRunService();
      return service.getRunByIdempotencyKey({
        tenantId: input.projectId,
        idempotencyKey: input.idempotencyKey,
      });
    }),

  resolveArchivedNames: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        scenarioIds: z.array(z.string()),
        targets: z.array(suiteTargetSchema),
      }),
    )
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ ctx, input }) => {
      const projectRepository = new ProjectRepository(ctx.prisma);
      const organizationId = await projectRepository.getOrganizationId({
        projectId: input.projectId,
      });
      if (!organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found for project",
        });
      }
      const service = SuiteService.create(ctx.prisma);
      return service.resolveArchivedNames({
        ...input,
        organizationId,
      });
    }),

  run: protectedProcedure
    .input(projectSchema.extend({ id: z.string(), idempotencyKey: z.string().optional() }))
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = SuiteService.create(ctx.prisma);
      const suite = await service.getById(input);
      if (!suite) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Suite not found",
        });
      }

      const projectRepository = new ProjectRepository(ctx.prisma);
      const organizationId = await projectRepository.getOrganizationId({
        projectId: input.projectId,
      });
      if (!organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found for project",
        });
      }

      try {
        const result = await service.run({
          suite,
          projectId: input.projectId,
          organizationId,
          idempotencyKey: input.idempotencyKey,
        });

        return {
          scheduled: true,
          ...result,
        };
      } catch (error) {
        if (error instanceof SuiteDomainError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message,
          });
        }
        const message =
          error instanceof Error ? error.message : "Unknown error";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message,
        });
      }
    }),

  onSuiteRunUpdate: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("scenarios:view"))
    .subscription(async function* (opts) {
      const { projectId } = opts.input;
      const emitter = getApp().broadcast.getTenantEmitter(projectId);

      logger.info({ projectId }, "Suite run SSE subscription started");

      for await (const eventArgs of on(emitter, "suite_run_updated", {
        // @ts-expect-error - signal is not typed
        signal: opts.signal,
      })) {
        logger.debug(
          { projectId, event: eventArgs[0] },
          "Suite run SSE event received",
        );
        yield eventArgs[0];
      }
    }),
});
