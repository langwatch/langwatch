import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../trpc";

import { skipPermissionCheck } from "../permission";

export const optimizationRouter = createTRPCRouter({
  chat: publicProcedure
    .input(
      z.object({
        workflowId: z.string(),
        inputMessages: z.array(z.record(z.string(), z.string())),
        projectId: z.string(),
      })
    )
    .use(skipPermissionCheck)
    .mutation(async ({ ctx, input }) => {
      const { workflowId, inputMessages, projectId } = input;

      const project = await ctx.prisma.project.findFirst({
        where: { id: projectId },
      });

      const apiKey = project?.apiKey;

      const response = await fetch(
        `${process.env.BASE_HOST}/api/optimization/${workflowId}`,
        {
          method: "POST",
          body: JSON.stringify(inputMessages[0]),
          headers: {
            "Content-Type": "application/json",
            ...(apiKey && { "x-auth-token": apiKey }),
          },
        }
      );

      return await response.json();
    }),
  getPublishedWorkflow: publicProcedure
    .input(z.object({ workflowId: z.string(), projectId: z.string() }))
    .use(skipPermissionCheck)
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

      const isComponent = workflow?.isComponent;
      const isEvaluator = workflow?.isEvaluator;

      return { ...publishedWorkflow, isComponent, isEvaluator };
    }),
  toggleSaveAsComponent: publicProcedure
    .input(
      z.object({
        workflowId: z.string(),
        projectId: z.string(),
        isComponent: z.boolean(),
        isEvaluator: z.boolean(),
      })
    )
    .use(skipPermissionCheck)
    .mutation(async ({ ctx, input }) => {
      const { workflowId, projectId, isComponent } = input;
      let { isEvaluator } = input;

      if (isComponent) {
        isEvaluator = false;
      }

      try {
        const result = await ctx.prisma.workflow.update({
          where: { id: workflowId, projectId: projectId },
          data: { isComponent, isEvaluator: isEvaluator },
        });
        return { success: true };
      } catch (error) {
        throw error;
      }
    }),
  toggleSaveAsEvaluator: publicProcedure
    .input(
      z.object({
        workflowId: z.string(),
        projectId: z.string(),
        isEvaluator: z.boolean(),
        isComponent: z.boolean(),
      })
    )
    .use(skipPermissionCheck)
    .mutation(async ({ ctx, input }) => {
      const { workflowId, projectId, isEvaluator, isComponent } = input;

      try {
        await ctx.prisma.workflow.update({
          where: { id: workflowId, projectId: projectId },
          data: { isEvaluator, isComponent: !isEvaluator },
        });
        return { success: true };
      } catch (error) {
        throw error;
      }
    }),
  getComponents: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .use(skipPermissionCheck)
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
          (version) => version.id === workflow.publishedId
        );
      });

      return workflows;
    }),
});
