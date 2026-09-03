/**
 * Gateway guardrails over the process's tRPC transport.
 *
 * A guardrail is a project-scoped first-class resource the gateway invokes per
 * direction on inbound and outbound traffic. A virtual key opts in through
 * `config.guardrailAttachments[]`; this is the administrative surface behind
 * /gateway/guardrails.
 *
 * Transport only. The guardrail capability is built over persistence and the
 * evaluator and monitor services, so the feature's application holds it
 * already-built and this transport never sees either service.
 *
 * Spec: specs/ai-gateway/governance/guardrails-project-scope.feature
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  gatewayGuardrailDirectionSchema,
  gatewayGuardrailFailureModeSchema,
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
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      list: policy("gatewayGuardrails:view")(procedure.input(projectScopeSchema)).query(
        async ({ ctx, input }) => ctx.app.gateway.budgetDecisions.guardrailList(input.projectId),
      ),

      get: policy("gatewayGuardrails:view")(procedure.input(guardrailIdSchema)).query(
        async ({ ctx, input }) =>
          ctx.app.gateway.budgetDecisions.tryGuardrailGet({
            id: input.id,
            projectId: input.projectId,
          }),
      ),

      create: policy("gatewayGuardrails:manage")(
        procedure.input(
          z.object({
            projectId: z.string(),
            name: z.string().min(1).max(128),
            description: z.string().max(512).nullable().optional(),
            evaluatorId: z.string(),
            direction: directionSchema,
            failureMode: failureModeSchema.optional(),
          }),
        ),
      ).mutation(async ({ ctx, input }) =>
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

      update: policy("gatewayGuardrails:manage")(
        procedure.input(
          z.object({
            projectId: z.string(),
            id: z.string(),
            name: z.string().min(1).max(128).optional(),
            description: z.string().max(512).nullable().optional(),
            evaluatorId: z.string().optional(),
            direction: directionSchema.optional(),
            failureMode: failureModeSchema.optional(),
          }),
        ),
      ).mutation(async ({ ctx, input }) =>
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

      archive: policy("gatewayGuardrails:manage")(procedure.input(guardrailIdSchema)).mutation(
        async ({ ctx, input }) => {
          await ctx.app.gateway.budgetDecisions.guardrailArchive({
            id: input.id,
            projectId: input.projectId,
            actorUserId: ctx.actor().id,
          });
          return { ok: true };
        },
      ),
    });
  }
}
