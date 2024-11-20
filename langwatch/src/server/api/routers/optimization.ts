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

      return { ...publishedWorkflow, isComponent };
    }),
  toggleSaveAsComponent: publicProcedure
    .input(
      z.object({
        workflowId: z.string(),
        projectId: z.string(),
        isComponent: z.boolean(),
      })
    )
    .use(skipPermissionCheck)
    .mutation(async ({ ctx, input }) => {
      const { workflowId, projectId, isComponent } = input;

      try {
        const result = await ctx.prisma.workflow.update({
          where: { id: workflowId, projectId: projectId },
          data: { isComponent },
        });

        console.log("Server: Update successful", result);
        return { success: true };
      } catch (error) {
        console.error("Server: Update failed", error);
        throw error;
      }
    }),
  getComponents: publicProcedure
    .input(z.object({ workflowId: z.string(), projectId: z.string() }))
    .use(skipPermissionCheck)
    .query(async ({ ctx, input }) => {
      const { projectId } = input;
      const workflows = await ctx.prisma.workflow.findMany({
        where: {
          projectId: projectId,
          isComponent: true,
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
