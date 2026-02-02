import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  codeComponentSchema,
  customComponentSchema,
  httpComponentSchema,
  signatureComponentSchema,
} from "~/optimization_studio/types/dsl";
import {
  type AgentComponentConfig,
  type AgentType,
  agentTypeSchema,
} from "../../agents/agent.repository";
import { AgentService } from "../../agents/agent.service";
import { enforceLicenseLimit } from "../../license-enforcement";
import { checkProjectPermission, hasProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { copyWorkflowWithDatasets } from "./workflows";

/**
 * Get config schema based on agent type for validation
 */
const getConfigInputSchema = (type: AgentType) => {
  switch (type) {
    case "signature":
      return signatureComponentSchema;
    case "code":
      return codeComponentSchema;
    case "workflow":
      return customComponentSchema;
    case "http":
      return httpComponentSchema;
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown agent type: ${_exhaustive}`);
    }
  }
};

/**
 * Agent Router - Manages agent CRUD operations
 *
 * Agents are reusable LLM components that can be:
 * - signature: LLM-based with prompt configuration (matches LlmPromptConfigComponent)
 * - code: Python code executor (matches Code component with code parameter)
 * - workflow: Reference to an existing workflow (matches Custom component)
 * - http: External API caller with configurable URL, headers, auth, and body template
 *
 * Config is stored as DSL-compatible node data for direct execution.
 */
export const agentsRouter = createTRPCRouter({
  /**
   * Gets all agents for a project
   * Returns typed agents with parsed config matching DSL node data
   */
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("evaluations:view"))
    .query(async ({ ctx, input }) => {
      const agentService = AgentService.create(ctx.prisma);
      return await agentService.getAll({ projectId: input.projectId });
    }),

  /**
   * Gets a single agent by ID
   * Returns typed agent with parsed config matching DSL node data
   */
  getById: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string() }))
    .use(checkProjectPermission("evaluations:view"))
    .query(async ({ ctx, input }) => {
      const agentService = AgentService.create(ctx.prisma);
      return await agentService.getById({
        id: input.id,
        projectId: input.projectId,
      });
    }),

  /**
   * Creates a new agent
   * Validates config matches the specified type's DSL schema
   */
  create: protectedProcedure
    .input(
      z
        .object({
          projectId: z.string(),
          name: z.string().min(1).max(255),
          type: agentTypeSchema,
          // Accept any object, validation happens in refine
          config: z.record(z.unknown()),
          workflowId: z.string().optional(),
        })
        .refine(
          (data) => {
            // Validate config matches the specified type's DSL schema
            const schema = getConfigInputSchema(data.type);
            const result = schema.safeParse(data.config);
            return result.success;
          },
          {
            message:
              "Config does not match the specified agent type's DSL schema",
            path: ["config"],
          },
        ),
    )
    .use(checkProjectPermission("evaluations:manage"))
    .mutation(async ({ ctx, input }) => {
      // Enforce license limit before creating agent
      await enforceLicenseLimit(ctx, input.projectId, "agents");

      const agentService = AgentService.create(ctx.prisma);
      // Config is validated by the refine above, safe to cast
      return await agentService.create({
        id: `agent_${nanoid()}`,
        projectId: input.projectId,
        name: input.name,
        type: input.type,
        config: input.config as AgentComponentConfig,
        workflowId: input.workflowId,
      });
    }),

  /**
   * Updates an existing agent
   * Validates config if provided
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        projectId: z.string(),
        name: z.string().min(1).max(255).optional(),
        type: agentTypeSchema.optional(),
        // Accept any object, validation happens in repository
        config: z.record(z.unknown()).optional(),
        workflowId: z.string().nullable().optional(),
      }),
    )
    .use(checkProjectPermission("evaluations:manage"))
    .mutation(async ({ ctx, input }) => {
      const agentService = AgentService.create(ctx.prisma);

      // Repository will validate config against the type's DSL schema
      return await agentService.update({
        id: input.id,
        projectId: input.projectId,
        data: {
          ...(input.name && { name: input.name }),
          ...(input.type && { type: input.type }),
          ...(input.config && { config: input.config as AgentComponentConfig }),
          ...(input.workflowId !== undefined && {
            workflowId: input.workflowId,
          }),
        },
      });
    }),

  /**
   * Gets entities related to an agent for cascade archive warning.
   * Returns linked workflow that would be affected.
   */
  getRelatedEntities: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string() }))
    .use(checkProjectPermission("evaluations:view"))
    .query(async ({ ctx, input }) => {
      const agent = await ctx.prisma.agent.findFirst({
        where: {
          id: input.id,
          projectId: input.projectId,
          archivedAt: null,
        },
        select: { id: true, workflowId: true },
      });

      // Find the linked workflow (if any)
      const workflow =
        agent?.workflowId
          ? await ctx.prisma.workflow.findFirst({
              where: {
                id: agent.workflowId,
                projectId: input.projectId,
                archivedAt: null,
              },
              select: { id: true, name: true },
            })
          : null;

      return { workflow };
    }),

  /**
   * Archives an agent and its linked workflow in a transaction.
   */
  cascadeArchive: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string() }))
    .use(checkProjectPermission("evaluations:manage"))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.$transaction(async (tx) => {
        // 1. Get the agent to find linked workflow
        const agent = await tx.agent.findFirst({
          where: {
            id: input.id,
            projectId: input.projectId,
            archivedAt: null,
          },
          select: { id: true, workflowId: true },
        });

        if (!agent) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Agent not found",
          });
        }

        // 2. Archive the agent
        const archivedAgent = await tx.agent.update({
          where: { id: input.id, projectId: input.projectId },
          data: { archivedAt: new Date() },
        });

        // 3. Archive the linked workflow (if any)
        let archivedWorkflow = null;
        if (agent.workflowId) {
          archivedWorkflow = await tx.workflow.update({
            where: { id: agent.workflowId, projectId: input.projectId },
            data: { archivedAt: new Date() },
          });
        }

        return {
          agent: archivedAgent,
          archivedWorkflow,
        };
      });
    }),

  /**
   * Soft deletes an agent
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string() }))
    .use(checkProjectPermission("evaluations:manage"))
    .mutation(async ({ ctx, input }) => {
      const agentService = AgentService.create(ctx.prisma);
      return await agentService.softDelete({
        id: input.id,
        projectId: input.projectId,
      });
    }),

  /**
   * Get copies of an agent (replicas in other projects) for push selection.
   */
  getCopies: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        agentId: z.string(),
      }),
    )
    .use(checkProjectPermission("evaluations:view"))
    .query(async ({ ctx, input }) => {
      const source = await ctx.prisma.agent.findFirst({
        where: {
          id: input.agentId,
          projectId: input.projectId,
          archivedAt: null,
        },
      });
      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Agent not found",
        });
      }
      const copies = await ctx.prisma.agent.findMany({
        where: {
          copiedFromAgentId: input.agentId,
          archivedAt: null,
        },
        select: {
          id: true,
          name: true,
          projectId: true,
          project: {
            select: {
              name: true,
              team: {
                select: {
                  name: true,
                  organization: { select: { name: true } },
                },
              },
            },
          },
        },
      });

      const authorizedCopies = await Promise.all(
        copies.map(async (c) => ({
          copy: c,
          hasPermission: await hasProjectPermission(
            ctx,
            c.projectId,
            "evaluations:view",
          ),
        })),
      ).then((results) =>
        results.filter((r) => r.hasPermission).map((r) => r.copy),
      );

      return authorizedCopies.map((c) => ({
        id: c.id,
        name: c.name,
        projectId: c.projectId,
        fullPath: `${c.project.team.organization.name} / ${c.project.team.name} / ${c.project.name}`,
      }));
    }),

  /**
   * Copy (replicate) an agent to another project.
   */
  copy: protectedProcedure
    .input(
      z.object({
        agentId: z.string(),
        projectId: z.string(),
        sourceProjectId: z.string(),
      }),
    )
    .use(checkProjectPermission("evaluations:manage"))
    .mutation(async ({ ctx, input }) => {
      await enforceLicenseLimit(ctx, input.projectId, "agents");

      const hasSourcePermission = await hasProjectPermission(
        ctx,
        input.sourceProjectId,
        "evaluations:manage",
      );
      if (!hasSourcePermission) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message:
            "You do not have permission to manage evaluations in the source project",
        });
      }

      const source = await ctx.prisma.agent.findFirst({
        where: {
          id: input.agentId,
          projectId: input.sourceProjectId,
          archivedAt: null,
        },
        include: {
          workflow: { include: { latestVersion: true } },
        },
      });

      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Agent not found",
        });
      }

      let newWorkflowId: string | null = null;
      if (
        source.type === "workflow" &&
        source.workflowId &&
        source.workflow?.latestVersion?.dsl
      ) {
        const { workflowId } = await copyWorkflowWithDatasets({
          ctx,
          workflow: {
            id: source.workflow.id,
            name: source.workflow.name,
            icon: source.workflow.icon,
            description: source.workflow.description,
            latestVersion: source.workflow.latestVersion,
          },
          targetProjectId: input.projectId,
          sourceProjectId: input.sourceProjectId,
          copiedFromWorkflowId: source.workflowId,
        });
        newWorkflowId = workflowId;
      }

      const agentService = AgentService.create(ctx.prisma);
      const copied = await agentService.create({
        id: `agent_${nanoid()}`,
        projectId: input.projectId,
        name: source.name,
        type: source.type as AgentType,
        config: source.config as AgentComponentConfig,
        workflowId: newWorkflowId ?? undefined,
      });

      await ctx.prisma.agent.update({
        where: { id: copied.id },
        data: { copiedFromAgentId: source.id },
      });

      return { ...copied, copiedFromAgentId: source.id };
    }),

  /**
   * Push source agent config to selected copies (replicas).
   */
  pushToCopies: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        agentId: z.string(),
        copyIds: z.array(z.string()).optional(),
      }),
    )
    .use(checkProjectPermission("evaluations:manage"))
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.prisma.agent.findFirst({
        where: {
          id: input.agentId,
          projectId: input.projectId,
          archivedAt: null,
        },
        include: {
          _count: { select: { copiedAgents: true } },
          copiedAgents: {
            where: { archivedAt: null },
            select: { id: true, projectId: true },
          },
        },
      });

      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Agent not found",
        });
      }
      if (source.copiedAgents.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This agent has no copies to push to",
        });
      }

      const copiesToPush = input.copyIds
        ? source.copiedAgents.filter((c) => input.copyIds!.includes(c.id))
        : source.copiedAgents;

      if (copiesToPush.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No valid copies selected to push to",
        });
      }

      let pushedTo = 0;
      for (const copy of copiesToPush) {
        const hasPermission = await hasProjectPermission(
          ctx,
          copy.projectId,
          "evaluations:manage",
        );
        if (!hasPermission) continue;

        await ctx.prisma.agent.update({
          where: { id: copy.id },
          data: {
            name: source.name,
            config:
              source.config === null
                ? Prisma.JsonNull
                : (source.config as Prisma.InputJsonValue),
          },
        });
        pushedTo++;
      }

      return { pushedTo, selectedCopies: copiesToPush.length };
    }),

  /**
   * Sync a copied agent from its source.
   */
  syncFromSource: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        agentId: z.string(),
      }),
    )
    .use(checkProjectPermission("evaluations:manage"))
    .mutation(async ({ ctx, input }) => {
      const copy = await ctx.prisma.agent.findFirst({
        where: {
          id: input.agentId,
          projectId: input.projectId,
          archivedAt: null,
        },
        select: { id: true, name: true, copiedFromAgentId: true },
      });

      if (!copy?.copiedFromAgentId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This agent is not a copy and has no source to sync from",
        });
      }

      const source = await ctx.prisma.agent.findFirst({
        where: { id: copy.copiedFromAgentId, archivedAt: null },
        select: { projectId: true, name: true, config: true },
      });

      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Source agent has been deleted",
        });
      }

      const hasSourcePermission = await hasProjectPermission(
        ctx,
        source.projectId,
        "evaluations:manage",
      );
      if (!hasSourcePermission) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message:
            "You do not have permission to manage evaluations in the source project",
        });
      }

      await ctx.prisma.agent.update({
        where: { id: copy.id },
        data: {
          name: source.name,
          config:
            source.config === null
              ? Prisma.JsonNull
              : (source.config as Prisma.InputJsonValue),
        },
      });

      return { ok: true };
    }),
});
