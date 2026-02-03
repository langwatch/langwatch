import type { JsonValue } from "@prisma/client/runtime/library";
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
import {
  copyWorkflowWithDatasets,
  saveOrCommitWorkflowVersion,
} from "./workflows";

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
      const workflow = agent?.workflowId
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
      const agentService = AgentService.create(ctx.prisma);
      const source = await agentService.getById({
        id: input.agentId,
        projectId: input.projectId,
      });
      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Agent not found",
        });
      }
      const copies = await agentService.getCopies(input.agentId);

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

      const agentService = AgentService.create(ctx.prisma);
      try {
        return await agentService.copyAgent(
          {
            sourceAgentId: input.agentId,
            sourceProjectId: input.sourceProjectId,
            targetProjectId: input.projectId,
            newAgentId: `agent_${nanoid()}`,
          },
          {
            copyWorkflow: async (opts) => {
              const { workflowId, dsl } = await copyWorkflowWithDatasets({
                ctx,
                workflow: {
                  ...opts.workflow,
                  latestVersion: opts.workflow.latestVersion
                    ? {
                        dsl: opts.workflow.latestVersion.dsl as JsonValue,
                      }
                    : null,
                },
                targetProjectId: opts.targetProjectId,
                sourceProjectId: opts.sourceProjectId,
                copiedFromWorkflowId: opts.copiedFromWorkflowId,
              });
              await saveOrCommitWorkflowVersion({
                ctx,
                input: {
                  projectId: opts.targetProjectId,
                  workflowId,
                  dsl,
                },
                autoSaved: false,
                commitMessage: "Copied from " + opts.workflow.name,
              });
              return { workflowId };
            },
          },
        );
      } catch (error) {
        if (error instanceof Error && error.message === "Agent not found") {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Agent not found",
          });
        }
        throw error;
      }
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
      const agentService = AgentService.create(ctx.prisma);
      const copies = await agentService.getCopies(input.agentId);
      const permittedCopyIds = (
        await Promise.all(
          copies.map(async (c) => ({
            id: c.id,
            hasPermission: await hasProjectPermission(
              ctx,
              c.projectId,
              "evaluations:manage",
            ),
          })),
        )
      )
        .filter((r) => r.hasPermission)
        .map((r) => r.id);
      const copyIdsToPush =
        input.copyIds != null
          ? input.copyIds.filter((id) => permittedCopyIds.includes(id))
          : permittedCopyIds;

      try {
        return await agentService.pushToCopies(
          input.agentId,
          input.projectId,
          copyIdsToPush,
        );
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === "Agent not found") {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Agent not found",
            });
          }
          if (
            error.message === "This agent has no copies to push to" ||
            error.message === "No valid copies selected to push to"
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: error.message,
            });
          }
        }
        throw error;
      }
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
      const agentService = AgentService.create(ctx.prisma);
      const copy = await agentService.getById({
        id: input.agentId,
        projectId: input.projectId,
      });
      if (!copy?.copiedFromAgentId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This agent is not a copy and has no source to sync from",
        });
      }
      const source = await agentService.getByIdOnly(copy.copiedFromAgentId);
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
      try {
        return await agentService.syncFromSource(
          input.agentId,
          input.projectId,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          message ===
            "This agent is not a copy and has no source to sync from" ||
          message === "Source agent has been deleted"
        ) {
          throw new TRPCError({
            code:
              message === "Source agent has been deleted"
                ? "NOT_FOUND"
                : "BAD_REQUEST",
            message,
          });
        }
        throw error;
      }
    }),
});
