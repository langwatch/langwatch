import type { JsonValue } from "@prisma/client/runtime/client";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { ConnectedComponentConfig } from "~/optimization_studio/types/dsl";
import { probeProjectPermission } from "~/server/app-layer/permissions/imperative";
import {
  DEFAULT_CALL_TIMEOUT_MS,
  MAX_CALL_TIMEOUT_MS,
} from "~/server/connected-agents/constants";
import {
  type AgentInstanceView,
  type AgentPresenceStatus,
  NO_PRESENCE,
  readAgentPresence,
} from "~/server/connected-agents/presence.read";
import { getConnectedAgentRuntime } from "~/server/connected-agents/runtime";
import type { ScenarioParameterDefinition } from "~/server/scenarios/parameters";
import { assertConnectedAgentsRunnable } from "~/server/suites/connected-targets";
import {
  type AgentComponentConfig,
  agentTypeSchema,
  getConfigSchemaForType,
} from "../../agents/agent.repository";
import {
  AgentService,
  declaredAgentParameters,
} from "../../agents/agent.service";
import type { AgentWithFields } from "../../agents/agent-fields";
import { AgentRegisterOnlyError } from "../../agents/errors";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  copyWorkflowWithDatasets,
  saveOrCommitWorkflowVersion,
} from "./workflows";

/**
 * What every agent read carries beside the row (ADR-128): the parameters a
 * connected agent declares, the owner of a personal one, and its presence.
 * Other kinds read as offline with no instances and no owner.
 */
async function withConnectedAgentViews<T extends AgentWithFields>({
  agents,
  projectId,
  agentService,
}: {
  agents: T[];
  projectId: string;
  agentService: AgentService;
}): Promise<
  (T & {
    parameters: ScenarioParameterDefinition[];
    owner: { userId: string; name: string | null } | null;
    status: AgentPresenceStatus;
    instances: AgentInstanceView[];
  })[]
> {
  const [owners, presence] = await Promise.all([
    agentService.ownersOf(agents),
    readAgentPresence({ projectId, agents }),
  ]);
  return agents.map((agent) => {
    const owner = agent.ownerUserId
      ? (owners.get(agent.ownerUserId) ?? {
          userId: agent.ownerUserId,
          name: null,
        })
      : null;
    const { status, instances } = presence.get(agent.id) ?? NO_PRESENCE;
    return {
      ...agent,
      parameters: declaredAgentParameters(agent),
      owner,
      status,
      instances,
    };
  });
}

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
    .permission("evaluations:view")
    .query(async ({ ctx, input }) => {
      const agentService = AgentService.create(ctx.prisma);
      const agents = await agentService.getAll({ projectId: input.projectId });
      return withConnectedAgentViews({
        agents,
        projectId: input.projectId,
        agentService,
      });
    }),

  /**
   * Gets a single agent by ID
   * Returns typed agent with parsed config matching DSL node data
   */
  getById: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string() }))
    .permission("evaluations:view")
    .query(async ({ ctx, input }) => {
      const agentService = AgentService.create(ctx.prisma);
      const agent = await agentService.getById({
        id: input.id,
        projectId: input.projectId,
      });
      if (!agent) return null;
      const [view] = await withConnectedAgentViews({
        agents: [agent],
        projectId: input.projectId,
        agentService,
      });
      return view ?? null;
    }),

  /**
   * Creates a new agent
   * Validates config matches the specified type's DSL schema
   */
  create: protectedProcedure
    .input(
      z
        .object({
          // Generated server-side so it's present in audit log args for history lookup
          id: z.string().default(() => `agent_${nanoid()}`),
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
            const schema = getConfigSchemaForType(data.type);
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
    .permission("evaluations:manage")
    .mutation(async ({ ctx, input }) => {
      // A connected agent is registered by the SDK from the process that runs
      // it; there is nothing a form could fill in for one.
      if (input.type === "connected") throw new AgentRegisterOnlyError();
      const agentService = AgentService.create(ctx.prisma);
      // Config is validated by the refine above, safe to cast
      return await agentService.create({
        id: input.id,
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
    .permission("evaluations:manage")
    .mutation(async ({ ctx, input }) => {
      const agentService = AgentService.create(ctx.prisma);

      // Repository will validate config against the type's DSL schema
      return await agentService.update({
        id: input.id,
        projectId: input.projectId,
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.type !== undefined && { type: input.type }),
          ...(input.config !== undefined && {
            config: input.config as AgentComponentConfig,
          }),
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
    .permission("evaluations:view")
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
    .permission("evaluations:manage")
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
    .permission("evaluations:manage")
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
    .permission("evaluations:view")
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
          hasPermission: await probeProjectPermission(
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
        // Generated server-side so it's present in audit log args for history lookup
        newAgentId: z.string().default(() => `agent_${nanoid()}`),
      }),
    )
    .permission("evaluations:manage")
    .mutation(async ({ ctx, input }) => {
      const hasSourcePermission = await probeProjectPermission(
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
            newAgentId: input.newAgentId,
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
    .permission("evaluations:manage")
    .mutation(async ({ ctx, input }) => {
      const agentService = AgentService.create(ctx.prisma);
      const copies = await agentService.getCopies(input.agentId);
      const permittedCopyIds = (
        await Promise.all(
          copies.map(async (c) => ({
            id: c.id,
            hasPermission: await probeProjectPermission(
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
    .permission("evaluations:manage")
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
      const hasSourcePermission = await probeProjectPermission(
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

  /**
   * Sends one turn to a connected agent and answers what its function
   * returned (ADR-128).
   *
   * The Test button of the agent drawer. It walks the same path a simulation
   * turn walks, so what a person sees here is what a run will see: the same
   * dispatcher, the same instance choice, the same handled errors. A personal
   * development agent of another person is refused before anything is sent.
   */
  testConnected: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        projectId: z.string(),
        message: z.string().min(1),
        params: z
          .record(z.union([z.string(), z.number(), z.boolean()]))
          .optional(),
      }),
    )
    .permission("evaluations:manage")
    .mutation(async ({ ctx, input }) => {
      const agent = await AgentService.create(ctx.prisma).getById({
        id: input.id,
        projectId: input.projectId,
      });
      if (agent?.type !== "connected") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Connected agent not found",
        });
      }
      await assertConnectedAgentsRunnable({
        agents: [
          {
            id: agent.id,
            name: agent.name,
            type: agent.type,
            config: agent.config as JsonValue,
            environment: agent.environment,
            ownerUserId: agent.ownerUserId,
            hostLabel: agent.hostLabel,
            archivedAt: agent.archivedAt,
          },
        ],
        actor: { id: ctx.session.user.id, label: "user" },
        users: ctx.prisma,
      });

      const config = agent.config as ConnectedComponentConfig;
      const messages = [{ role: "user" as const, content: input.message }];
      const outcome = await getConnectedAgentRuntime().dispatcher.dispatch({
        projectId: input.projectId,
        agent: {
          id: agent.id,
          name: agent.name,
          environment: agent.environment,
          timeoutMs: Math.min(
            config.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
            MAX_CALL_TIMEOUT_MS,
          ),
          sticky: config.sticky ?? false,
        },
        call: {
          threadId: crypto.randomUUID(),
          messages,
          newMessages: messages,
          params: input.params ?? {},
          session: undefined,
          traceparent: null,
          run: {},
        },
      });
      return {
        output: outcome.output,
        instance: {
          hostname: outcome.instance.hostname,
          label: outcome.instance.label,
        },
        durationMs: outcome.durationMs,
      };
    }),

  /**
   * Returns the audit log history for a specific agent.
   * Used by the "View History" drawer on the agents page.
   */
  getHistory: protectedProcedure
    .input(z.object({ agentId: z.string(), projectId: z.string() }))
    .permission("evaluations:view")
    .query(async ({ ctx, input }) => {
      const service = AgentService.create(ctx.prisma);
      return service.getHistory(input.agentId, input.projectId);
    }),
});
