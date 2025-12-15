import { AlertType, TriggerAction } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { type FilterField, filterFieldsEnum } from "../../filters/types";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const graphsRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string(),
        graph: z.string(),
        filterParams: z.any().optional(),
        alert: z
          .object({
            enabled: z.boolean(),
            threshold: z.number(),
            operator: z.enum(["gt", "lt", "gte", "lte", "eq"]),
            timePeriod: z.number(),
            type: z.nativeEnum(AlertType),
            action: z.nativeEnum(TriggerAction),
            actionParams: z
              .object({
                members: z.array(z.string()).optional(),
                slackWebhook: z.string().optional(),
              })
              .optional(),
          })
          .optional(),
      }),
    )
    .use(checkProjectPermission("analytics:create"))
    .mutation(async ({ ctx, input }) => {
      const graph = JSON.parse(input.graph);

      const customGraph = await ctx.prisma.customGraph.create({
        data: {
          id: nanoid(),
          name: input.name,
          graph: graph,
          projectId: input.projectId,
          filters: input.filterParams?.filters ?? {},
        },
      });

      // Create trigger if alert is enabled
      if (input.alert?.enabled) {
        await ctx.prisma.trigger.create({
          data: {
            id: nanoid(),
            name: `Alert: ${input.name}`,
            projectId: input.projectId,
            action: input.alert.action,
            actionParams: {
              ...input.alert.actionParams,
              threshold: input.alert.threshold,
              operator: input.alert.operator,
              timePeriod: input.alert.timePeriod,
            },
            filters: JSON.stringify({}),
            alertType: input.alert.type,
            active: true,
            lastRunAt: new Date().getTime(),
            customGraphId: customGraph.id,
          },
        });
      }

      return customGraph;
    }),
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("analytics:view"))
    .query(async ({ input, ctx }) => {
      const { projectId } = input;
      const prisma = ctx.prisma;

      const graphs = await prisma.customGraph.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
        include: {
          trigger: {
            where: {
              active: true,
              deleted: false,
            },
          },
        },
      });

      return graphs;
    }),
  delete: protectedProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .use(checkProjectPermission("analytics:delete"))
    .mutation(async ({ ctx, input }) => {
      const { id } = input;
      const prisma = ctx.prisma;

      const graph = await prisma.customGraph.findUnique({
        where: { id, projectId: input.projectId },
      });
      if (!graph) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Graph not found" });
      }

      await prisma.customGraph.delete({
        where: { id, projectId: input.projectId },
      });

      return graph;
    }),
  getById: protectedProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .use(checkProjectPermission("analytics:view"))
    .query(async ({ ctx, input }) => {
      const { id } = input;
      const prisma = ctx.prisma;

      const graph = await prisma.customGraph.findUnique({
        where: { id, projectId: input.projectId },
      });

      if (!graph) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Graph not found" });
      }

      // Basic validation to ensure filters have the expected structure
      let validatedFilters:
        | Record<FilterField, string[] | Record<string, string[]>>
        | undefined;

      if (graph.filters && typeof graph.filters === "object") {
        const validFilters: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(graph.filters)) {
          if (filterFieldsEnum.safeParse(key).success) {
            if (
              Array.isArray(value) ||
              (typeof value === "object" && value !== null)
            ) {
              validFilters[key] = value;
            }
          }
        }

        validatedFilters =
          Object.keys(validFilters).length > 0
            ? (validFilters as Record<
                FilterField,
                string[] | Record<string, string[]>
              >)
            : undefined;
      }

      // Find associated trigger for custom graph alert using direct relation
      const trigger = await prisma.trigger.findUnique({
        where: {
          customGraphId: id,
          projectId: input.projectId,
        },
      });

      let alertData = undefined;
      if (trigger && trigger.active && !trigger.deleted) {
        const actionParams = trigger.actionParams as any;
        alertData = {
          enabled: true,
          threshold: actionParams.threshold,
          operator: actionParams.operator,
          timePeriod: actionParams.timePeriod,
          type: trigger.alertType,
          action: trigger.action,
          actionParams: {
            members: actionParams.members,
            slackWebhook: actionParams.slackWebhook,
          },
          triggerId: trigger.id,
        };
      }

      return {
        ...graph,
        filters: validatedFilters,
        alert: alertData,
      };
    }),
  updateById: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string(),
        graph: z.string(),
        graphId: z.string(),
        filterParams: z.any().optional(),
        alert: z
          .object({
            enabled: z.boolean(),
            threshold: z.number(),
            operator: z.enum(["gt", "lt", "gte", "lte", "eq"]),
            timePeriod: z.number(),
            type: z.nativeEnum(AlertType),
            action: z.nativeEnum(TriggerAction),
            actionParams: z
              .object({
                members: z.array(z.string()).optional(),
                slackWebhook: z.string().optional(),
              })
              .optional(),
            triggerId: z.string().optional(),
          })
          .optional(),
      }),
    )
    .use(checkProjectPermission("analytics:update"))
    .mutation(async ({ ctx, input }) => {
      const prisma = ctx.prisma;

      const customGraph = await prisma.customGraph.update({
        where: { id: input.graphId, projectId: input.projectId },
        data: {
          name: input.name,
          graph: JSON.parse(input.graph),
          filters: input.filterParams?.filters ?? {},
        },
      });

      // Handle trigger update/create/delete
      const existingTrigger = await prisma.trigger.findUnique({
        where: { customGraphId: input.graphId, projectId: input.projectId },
      });

      if (input.alert?.enabled) {
        if (existingTrigger) {
          // Update existing trigger
          await prisma.trigger.update({
            where: { id: existingTrigger.id, projectId: input.projectId },
            data: {
              name: `Alert: ${input.name}`,
              action: input.alert.action,
              actionParams: {
                ...input.alert.actionParams,
                threshold: input.alert.threshold,
                operator: input.alert.operator,
                timePeriod: input.alert.timePeriod,
              },
              alertType: input.alert.type,
              active: true,
              deleted: false,
            },
          });
        } else {
          // Create new trigger
          await prisma.trigger.create({
            data: {
              id: nanoid(),
              name: `Alert: ${input.name}`,
              projectId: input.projectId,
              action: input.alert.action,
              actionParams: {
                ...input.alert.actionParams,
                threshold: input.alert.threshold,
                operator: input.alert.operator,
                timePeriod: input.alert.timePeriod,
              },
              filters: JSON.stringify({}),
              alertType: input.alert.type,
              active: true,
              lastRunAt: new Date().getTime(),
              customGraphId: input.graphId,
            },
          });
        }
      } else if (existingTrigger) {
        // Disable trigger if alert is disabled
        await prisma.trigger.update({
          where: { id: existingTrigger.id, projectId: input.projectId },
          data: { active: false, deleted: true },
        });
      }

      return customGraph;
    }),
});
