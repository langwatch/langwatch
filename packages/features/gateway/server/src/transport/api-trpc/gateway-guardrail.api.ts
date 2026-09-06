/**
 * Gateway guardrails over tRPC: the administrative surface behind /gateway/guardrails. A
 * virtual key opts in through `config.guardrailAttachments[]`.
 * Spec: specs/ai-gateway/governance/guardrails-project-scope.feature
 */
import { createTrpcService } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  gatewayGuardrailDirectionSchema,
  gatewayGuardrailFailureModeSchema,
  gatewayGuardrailResourceSchema,
} from "@langwatch/gateway-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import type { GatewayApp } from "#app/gateway.app";

/** The process supplies authentication; authorization arrives as `policy`. */
export type GatewayGuardrailTrpcContext = Readonly<{
  app: Readonly<{ gateway: GatewayApp }>;
  actor(): Readonly<{ id: string }>;
}>;

type ProcedureDecorator = <TProcedure>(procedure: TProcedure) => TProcedure;

type GatewayGuardrailTrpcProcedures<
  TContext extends GatewayGuardrailTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * Tracing, logging, error shaping, scope lineage, the check, and audit,
   * applied AFTER this feature's input parser.
   */
  policy(permission: AuthzPermission): ProcedureDecorator;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
}>;

const directionSchema = gatewayGuardrailDirectionSchema;
const failureModeSchema = gatewayGuardrailFailureModeSchema;

const projectScopeSchema = z.object({ projectId: z.string() });
const guardrailIdSchema = z.object({ projectId: z.string(), id: z.string() });

/** Installs the complete `gatewayGuardrails.*` tRPC surface on a process root. */
export class GatewayGuardrailTrpcApi {
  static create<
    TContext extends GatewayGuardrailTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: GatewayGuardrailTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy, validateOutput } = procedures;

    return createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .query("list", (p) =>
        p
          .withInput(projectScopeSchema)
          .withOutput(gatewayGuardrailResourceSchema.array())
          .withPermission("gatewayGuardrails:view")
          .handle(async ({ ctx, input }) =>
            ctx.app.gateway.budgetDecisions.guardrailList(input.projectId),
          ),
      )
      .query("get", (p) =>
        p
          .withInput(guardrailIdSchema)
          .withOutput(gatewayGuardrailResourceSchema.nullable())
          .withPermission("gatewayGuardrails:view")
          .handle(async ({ ctx, input }) =>
            ctx.app.gateway.budgetDecisions.tryGuardrailGet({
              id: input.id,
              projectId: input.projectId,
            }),
          ),
      )
      .mutation("create", (p) =>
        p
          .withInput(
            z.object({
              projectId: z.string(),
              name: z.string().min(1).max(128),
              description: z.string().max(512).nullable().optional(),
              evaluatorId: z.string(),
              direction: directionSchema,
              failureMode: failureModeSchema.optional(),
            }),
          )
          .withOutput(gatewayGuardrailResourceSchema)
          .withPermission("gatewayGuardrails:manage")
          .handle(async ({ ctx, input }) =>
            ctx.app.gateway.budgetDecisions.guardrailCreate({
              projectId: input.projectId,
              name: input.name,
              description: input.description ?? null,
              evaluatorId: input.evaluatorId,
              direction: input.direction,
              failureMode: input.failureMode,
              actorUserId: ctx.actor().id,
            }),
          ),
      )
      .mutation("update", (p) =>
        p
          .withInput(
            z.object({
              projectId: z.string(),
              id: z.string(),
              name: z.string().min(1).max(128).optional(),
              description: z.string().max(512).nullable().optional(),
              evaluatorId: z.string().optional(),
              direction: directionSchema.optional(),
              failureMode: failureModeSchema.optional(),
            }),
          )
          .withOutput(gatewayGuardrailResourceSchema)
          .withPermission("gatewayGuardrails:manage")
          .handle(async ({ ctx, input }) =>
            ctx.app.gateway.budgetDecisions.guardrailUpdate({
              id: input.id,
              projectId: input.projectId,
              name: input.name,
              description: input.description,
              evaluatorId: input.evaluatorId,
              direction: input.direction,
              failureMode: input.failureMode,
              actorUserId: ctx.actor().id,
            }),
          ),
      )
      .mutation("archive", (p) =>
        p
          .withInput(guardrailIdSchema)
          .withOutput(z.object({ ok: z.literal(true) }).strict())
          .withPermission("gatewayGuardrails:manage")
          .handle(async ({ ctx, input }) => {
            await ctx.app.gateway.budgetDecisions.guardrailArchive({
              id: input.id,
              projectId: input.projectId,
              actorUserId: ctx.actor().id,
            });
            return { ok: true };
          }),
      )
      .build();
  }
}
