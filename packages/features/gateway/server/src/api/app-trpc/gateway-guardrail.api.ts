/**
 * Gateway guardrails over the process's tRPC transport.
 *
 * A guardrail is a project-scoped first-class resource the gateway invokes per
 * direction on inbound and outbound traffic. A virtual key opts in through
 * `config.guardrailAttachments[]`; this is the administrative surface behind
 * /gateway/guardrails.
 *
 * Transport only. The guardrail capability is built over persistence and the
 * evaluator and monitor services, so it arrives as a port that takes the two
 * services off the request's application.
 *
 * Spec: specs/ai-gateway/governance/guardrails-project-scope.feature
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import type { MonitorService } from "@langwatch/monitor-contract";
import {
  GatewayGuardrailDirection,
  GatewayGuardrailFailureMode,
  type GatewayGuardrail,
} from "@langwatch/prisma-client/generated";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";

type GatewayGuardrailApplication = Readonly<{
  evaluators: EvaluatorService;
  monitors: MonitorService;
}>;

/** The process supplies authentication; authorization arrives as `policy`. */
export type GatewayGuardrailTrpcContext = Readonly<{
  app: GatewayGuardrailApplication;
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

/** The guardrail operations this transport calls, as the process exposes them. */
export type GatewayGuardrailOperations = Readonly<{
  list(projectId: string): Promise<GatewayGuardrail[]>;
  get(id: string, projectId: string): Promise<GatewayGuardrail | null>;
  create(input: {
    projectId: string;
    name: string;
    description: string | null;
    evaluatorId: string;
    direction: GatewayGuardrailDirection;
    failureMode?: GatewayGuardrailFailureMode;
    actorUserId: string;
  }): Promise<GatewayGuardrail>;
  update(input: {
    id: string;
    projectId: string;
    name?: string;
    description?: string | null;
    evaluatorId?: string;
    direction?: GatewayGuardrailDirection;
    failureMode?: GatewayGuardrailFailureMode;
    actorUserId: string;
  }): Promise<GatewayGuardrail>;
  archive(input: { id: string; projectId: string; actorUserId: string }): Promise<void>;
}>;

export type GatewayGuardrailTrpcPorts = Readonly<{
  /**
   * The process's guardrail capability, built over its own persistence and the
   * evaluator and monitor services this request carries.
   */
  guardrails(input: GatewayGuardrailApplication): GatewayGuardrailOperations;
}>;

const directionSchema = z.nativeEnum(GatewayGuardrailDirection);
const failureModeSchema = z.nativeEnum(GatewayGuardrailFailureMode);

const projectScopeSchema = z.object({ projectId: z.string() });
const guardrailIdSchema = z.object({ projectId: z.string(), id: z.string() });

/** Installs the complete `gatewayGuardrails.*` tRPC surface on a process root. */
export class GatewayGuardrailTrpcApi {
  static create<
    TContext extends GatewayGuardrailTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TPorts extends GatewayGuardrailTrpcPorts,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: GatewayGuardrailTrpcProcedures<TContext, TOptions, TRoot>,
    ports: TPorts,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      list: policy("gatewayGuardrails:view")(procedure.input(projectScopeSchema)).query(
        async ({ ctx, input }) => ports.guardrails(ctx.app).list(input.projectId),
      ),

      get: policy("gatewayGuardrails:view")(procedure.input(guardrailIdSchema)).query(
        async ({ ctx, input }) => ports.guardrails(ctx.app).get(input.id, input.projectId),
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
        ports.guardrails(ctx.app).create({
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
        ports.guardrails(ctx.app).update({
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
          await ports.guardrails(ctx.app).archive({
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
