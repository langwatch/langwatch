import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";

import { checkUserPermissionForProject, TeamRoleGroup } from "../permission";

export const optimizationRouter = createTRPCRouter({
  chat: protectedProcedure
    .input(
      z.object({
        workflowId: z.string(),
        inputMessages: z.array(z.record(z.string(), z.string())),
        projectId: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_VIEW))
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
  getPublishedWorkflow: protectedProcedure
    .input(z.object({ workflowId: z.string(), projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_VIEW))
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
  toggleSaveAsComponent: protectedProcedure
    .input(
      z.object({
        workflowId: z.string(),
        projectId: z.string(),
        isComponent: z.boolean(),
        isEvaluator: z.boolean(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_MANAGE))
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
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const { workflowId, projectId, isEvaluator } = input;

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
  getComponents: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_MANAGE))
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
