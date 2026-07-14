import { nanoid } from "nanoid";
import { z } from "zod";
import { EvaluatorService } from "../../evaluators/evaluator.service";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const optimizationRouter = createTRPCRouter({
  chat: protectedProcedure
    .input(
      z.object({
        workflowId: z.string(),
        inputMessages: z.array(z.record(z.string(), z.string())),
        projectId: z.string(),
      }),
    )
    .use(checkProjectPermission("workflows:view"))
    .mutation(async ({ ctx, input }) => {
      const { workflowId, inputMessages, projectId } = input;

      const project = await ctx.prisma.project.findFirst({
        where: { id: projectId },
      });

      const apiKey = project?.apiKey;

      const response = await fetch(
        `${process.env.BASE_HOST}/api/workflows/${workflowId}/run`,
        {
          method: "POST",
          body: JSON.stringify(inputMessages[0]),
          headers: {
            "Content-Type": "application/json",
            ...(apiKey && { "x-auth-token": apiKey }),
          },
        },
      );

      return await response.json();
    }),
  getPublishedWorkflow: protectedProcedure
    .input(z.object({ workflowId: z.string(), projectId: z.string() }))
    .use(checkProjectPermission("workflows:view"))
    .query(async ({ ctx, input }) => {
      const { workflowId, projectId } = input;
      const workflow = await ctx.prisma.workflow.findFirst({
        where: { id: workflowId, projectId: projectId },
      });
      const publishedWorkflow = await ctx.prisma.workflowVersion.findFirst({
        where: {
          id: workflow?.publishedId ?? "",
          projectId: projectId,
        },
      });

      if (!publishedWorkflow) {
        return null;
      }

      const isComponent = workflow?.isComponent;
      const isEvaluator = workflow?.isEvaluator;

      return { ...publishedWorkflow, isComponent, isEvaluator };
    }),
  disableAsComponent: protectedProcedure
    .input(z.object({ workflowId: z.string(), projectId: z.string() }))
    .use(checkProjectPermission("workflows:update"))
    .mutation(async ({ ctx, input }) => {
      const { workflowId, projectId } = input;

      try {
        await ctx.prisma.workflow.update({
          where: { id: workflowId, projectId: projectId },
          data: { isComponent: false },
        });
      } catch (error) {
        throw error;
      }

      return { success: true };
    }),
  disableAsEvaluator: protectedProcedure
    .input(z.object({ workflowId: z.string(), projectId: z.string() }))
    .use(checkProjectPermission("workflows:update"))
    .mutation(async ({ ctx, input }) => {
      const { workflowId, projectId } = input;

      try {
        await ctx.prisma.workflow.update({
          where: { id: workflowId, projectId: projectId },
          data: { isEvaluator: false },
        });

        // Archive the linked evaluator if it exists
        const linkedEvaluator = await ctx.prisma.evaluator.findFirst({
          where: {
            workflowId: workflowId,
            projectId: projectId,
            archivedAt: null,
          },
        });

        if (linkedEvaluator) {
          await ctx.prisma.evaluator.update({
            where: { id: linkedEvaluator.id, projectId: projectId },
            data: { archivedAt: new Date() },
          });
        }
      } catch (error) {
        throw error;
      }

      return { success: true };
    }),
  toggleSaveAsComponent: protectedProcedure
    .input(
      z.object({
        workflowId: z.string(),
        projectId: z.string(),
        isComponent: z.boolean(),
        isEvaluator: z.boolean(),
      }),
    )
    .use(checkProjectPermission("workflows:update"))
    .mutation(async ({ ctx, input }) => {
      const { workflowId, projectId, isComponent } = input;
      let { isEvaluator } = input;

      if (isComponent) {
        isEvaluator = false;
      }

      try {
        await ctx.prisma.workflow.update({
          where: { id: workflowId, projectId: projectId },
          data: { isComponent, isEvaluator: isEvaluator },
        });
        return { success: true };
      } catch (error) {
        throw error;
      }
    }),

  toggleSaveAsEvaluator: protectedProcedure
    .input(
      z.object({
        workflowId: z.string(),
        projectId: z.string(),
        isEvaluator: z.boolean(),
        isComponent: z.boolean(),
      }),
    )
    .use(checkProjectPermission("workflows:update"))
    .mutation(async ({ ctx, input }) => {
      const { workflowId, projectId, isEvaluator } = input;

      try {
        // Get the workflow to access its name
        const workflow = await ctx.prisma.workflow.findUnique({
          where: { id: workflowId, projectId: projectId },
        });

        if (!workflow) {
          throw new Error("Workflow not found");
        }

        // Update workflow flags
        await ctx.prisma.workflow.update({
          where: { id: workflowId, projectId: projectId },
          data: { isEvaluator, isComponent: !isEvaluator },
        });

        if (isEvaluator) {
          // Check if an evaluator already exists for this workflow
          const existingEvaluator = await ctx.prisma.evaluator.findFirst({
            where: {
              workflowId: workflowId,
              projectId: projectId,
              archivedAt: null,
            },
          });

          if (existingEvaluator) {
            // Update existing evaluator's name to match workflow
            await ctx.prisma.evaluator.update({
              where: { id: existingEvaluator.id, projectId: projectId },
              data: { name: workflow.name },
            });
          } else {
            // Create a new evaluator linked to this workflow
            const evaluatorService = EvaluatorService.create(ctx.prisma);
            await evaluatorService.create({
              id: `evaluator_${nanoid()}`,
              projectId: projectId,
              name: workflow.name,
              type: "workflow",
              config: {},
              workflowId: workflowId,
            });
          }
        }

        return { success: true };
      } catch (error) {
        throw error;
      }
    }),
  getComponents: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("workflows:view"))
    .query(async ({ ctx, input }) => {
      const { projectId } = input;
      const workflows = await ctx.prisma.workflow.findMany({
        where: {
          projectId: projectId,
          OR: [{ isComponent: true }, { isEvaluator: true }],
        },
        include: {
          versions: true,
        },
      });

      // Update the filtering to work with multiple workflows
      workflows.forEach((workflow) => {
        workflow.versions = workflow.versions.filter(
          (version) => version.id === workflow.publishedId,
        );
      });

      return workflows;
    }),
});
