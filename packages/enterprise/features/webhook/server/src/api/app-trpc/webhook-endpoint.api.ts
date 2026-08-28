/**
 * Webhook endpoint administration over the process's tRPC transport.
 *
 * The session-authenticated sibling of the organization-key REST surface at
 * /api/webhooks/v1: same service, same RBAC scopes
 * (`webhookEndpoints:view` | `:manage`), same enterprise plan gate.
 *
 * The surface belongs to the webhook feature rather than to the gateway, even
 * though the process happens to park its endpoint and health capabilities under
 * `app.gateway`: the service, the views, the delivery controls and every
 * refusal here are the webhook contract's, and none of them mention a virtual
 * key or a budget. The context below mirrors the process's own shape rather
 * than asking it to rearrange.
 *
 * ## Credentials
 *
 * The signing secret crosses to the client exactly twice — in the `create` and
 * `rollSecret` responses — and once each time. Every read path answers endpoint
 * views with no secret material.
 *
 * Transport only: input parsing, the entitlement gate, the typed-error
 * translation, and delegation.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  WEBHOOK_EVENT_TYPES,
  webhookDestinationKindSchema,
  WebhookEndpointNotFoundError,
  WebhookEndpointsNotEntitledError,
  WebhookEndpointValidationError,
} from "@langwatch/enterprise-webhook-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";
import type { WebhookEndpointRuntime } from "../../adapters/webhook-endpoint.webhook-endpoint.adapter";
import type { WebhookHealthService } from "../../services/webhook-health.service";

type WebhookEndpointApplication = Readonly<{
  gateway: Readonly<{
    webhookEndpoints: WebhookEndpointRuntime;
    webhookHealth: Pick<WebhookHealthService, "health">;
  }>;
}>;

/** The process supplies authentication; authorization arrives as `policy`. */
export type WebhookEndpointTrpcContext = Readonly<{
  app: WebhookEndpointApplication;
  actor(): Readonly<{ id: string }>;
}>;

type ProcedureDecorator = <TProcedure>(procedure: TProcedure) => TProcedure;

type WebhookEndpointTrpcProcedures<
  TContext extends WebhookEndpointTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * Tracing, logging, error shaping, scope lineage, the check and audit,
   * applied AFTER this feature's input parser: tRPC runs middlewares in the
   * order they were added, so a check installed before `.input()` would read no
   * organization id at all.
   */
  policy(permission: AuthzPermission): ProcedureDecorator;
}>;

export type WebhookEndpointTrpcPorts = Readonly<{
  /**
   * The enterprise gate for the whole surface: the organization's active plan
   * must carry webhook endpoints. Entitlement is process state, so it arrives
   * here rather than being read.
   */
  assertEntitled(organizationId: string): Promise<void>;
}>;

const orgInput = z.object({ organizationId: z.string() });
const endpointInput = orgInput.extend({ endpointId: z.string() });

/**
 * The queue half of a destination. Which credential fields are ALLOWED is the
 * service's call; this only says what may be sent.
 *
 * The credential fields are nullable, not merely optional, because the service
 * reads the two differently: absent means "keep what is stored" and null means
 * "clear it". Without null there is no way through this surface to rotate an
 * endpoint off static keys, which is the one operation a leaked key demands.
 */
const sqsDestinationInput = z.object({
  queueUrl: z.string(),
  roleArn: z.string().nullable().optional(),
  externalId: z.string().nullable().optional(),
  accessKeyId: z.string().nullable().optional(),
  secretAccessKey: z.string().nullable().optional(),
});

/** Installs the complete `webhookEndpoints.*` tRPC surface on a process root. */
export class WebhookEndpointTrpcApi {
  static create<
    TContext extends WebhookEndpointTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TPorts extends WebhookEndpointTrpcPorts,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: WebhookEndpointTrpcProcedures<TContext, TOptions, TRoot>,
    ports: TPorts,
  ) {
    const { protected: procedure, policy } = procedures;

    /**
     * The plan gate, installed after the RBAC check so membership is already
     * established when it runs — exactly the order this surface has always had.
     */
    const plan = async (input: { organizationId: string }): Promise<void> => {
      try {
        await ports.assertEntitled(input.organizationId);
      } catch (error) {
        if (error instanceof WebhookEndpointsNotEntitledError) {
          throw new TRPCError({ code: "FORBIDDEN", message: error.message });
        }
        throw error;
      }
    };

    /** Maps the service's named refusals onto their transport codes. */
    async function translating<T>(fn: () => Promise<T>): Promise<T> {
      try {
        return await fn();
      } catch (error) {
        if (error instanceof WebhookEndpointValidationError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        if (error instanceof WebhookEndpointNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: error.message });
        }
        throw error;
      }
    }

    return trpc.router({
      /** The event catalog the drawer renders its checkboxes from. */
      eventTypes: policy("webhookEndpoints:view")(procedure.input(orgInput))
        .use(async ({ input, next }) => {
          await plan(input);
          return next();
        })
        .query(() => WEBHOOK_EVENT_TYPES),

      list: policy("webhookEndpoints:view")(procedure.input(orgInput))
        .use(async ({ input, next }) => {
          await plan(input);
          return next();
        })
        .query(({ ctx, input }) =>
          ctx.app.gateway.webhookEndpoints.getAll({ organizationId: input.organizationId }),
        ),

      deliveries: policy("webhookEndpoints:view")(
        procedure.input(
          endpointInput.extend({
            limit: z.number().int().min(1).max(200).optional(),
            cursor: z.object({ firedAt: z.coerce.date(), id: z.string() }).optional(),
          }),
        ),
      )
        .use(async ({ input, next }) => {
          await plan(input);
          return next();
        })
        .query(({ ctx, input }) =>
          translating(() =>
            ctx.app.gateway.webhookEndpoints.getDeliveries({
              organizationId: input.organizationId,
              endpointId: input.endpointId,
              limit: input.limit,
              cursor: input.cursor,
            }),
          ),
        ),

      create: policy("webhookEndpoints:manage")(
        procedure.input(
          orgInput.extend({
            destinationKind: webhookDestinationKindSchema.optional(),
            url: z.string().optional(),
            sqs: sqsDestinationInput.optional(),
            enabledEvents: z.array(z.string()).min(1),
            maxBatchSize: z.number().int().optional(),
            maxBatchDelayMs: z.number().int().optional(),
            maxInFlight: z.number().int().optional(),
          }),
        ),
      )
        .use(async ({ input, next }) => {
          await plan(input);
          return next();
        })
        .mutation(({ ctx, input }) =>
          translating(() =>
            ctx.app.gateway.webhookEndpoints.create({
              organizationId: input.organizationId,
              destinationKind: input.destinationKind,
              url: input.url,
              sqs: input.sqs,
              enabledEvents: input.enabledEvents,
              maxBatchSize: input.maxBatchSize,
              maxBatchDelayMs: input.maxBatchDelayMs,
              maxInFlight: input.maxInFlight,
            }),
          ),
        ),

      health: policy("webhookEndpoints:view")(procedure.input(endpointInput))
        .use(async ({ input, next }) => {
          await plan(input);
          return next();
        })
        .query(({ ctx, input }) =>
          translating(() =>
            ctx.app.gateway.webhookHealth.health({
              organizationId: input.organizationId,
              endpointId: input.endpointId,
            }),
          ),
        ),

      update: policy("webhookEndpoints:manage")(
        procedure.input(
          endpointInput.extend({
            // Accepted only when it repeats the kind the endpoint already has.
            // Zod strips unknown keys, so leaving it out would silently drop a
            // caller's attempted kind change and answer success where REST
            // refuses: two surfaces, two answers to the same request.
            destinationKind: webhookDestinationKindSchema.optional(),
            url: z.string().optional(),
            sqs: sqsDestinationInput.partial().optional(),
            enabledEvents: z.array(z.string()).min(1).optional(),
            maxBatchSize: z.number().int().optional(),
            maxBatchDelayMs: z.number().int().optional(),
            maxInFlight: z.number().int().optional(),
          }),
        ),
      )
        .use(async ({ input, next }) => {
          await plan(input);
          return next();
        })
        .mutation(({ ctx, input }) =>
          translating(() =>
            ctx.app.gateway.webhookEndpoints.update({
              organizationId: input.organizationId,
              endpointId: input.endpointId,
              destinationKind: input.destinationKind,
              url: input.url,
              sqs: input.sqs,
              enabledEvents: input.enabledEvents,
              maxBatchSize: input.maxBatchSize,
              maxBatchDelayMs: input.maxBatchDelayMs,
              maxInFlight: input.maxInFlight,
            }),
          ),
        ),

      rollSecret: policy("webhookEndpoints:manage")(procedure.input(endpointInput))
        .use(async ({ input, next }) => {
          await plan(input);
          return next();
        })
        .mutation(({ ctx, input }) =>
          translating(() =>
            ctx.app.gateway.webhookEndpoints.rollSecret({
              organizationId: input.organizationId,
              endpointId: input.endpointId,
            }),
          ),
        ),

      enable: policy("webhookEndpoints:manage")(procedure.input(endpointInput))
        .use(async ({ input, next }) => {
          await plan(input);
          return next();
        })
        .mutation(({ ctx, input }) =>
          translating(() =>
            ctx.app.gateway.webhookEndpoints.enable({
              organizationId: input.organizationId,
              endpointId: input.endpointId,
            }),
          ),
        ),

      disable: policy("webhookEndpoints:manage")(procedure.input(endpointInput))
        .use(async ({ input, next }) => {
          await plan(input);
          return next();
        })
        .mutation(({ ctx, input }) =>
          translating(() =>
            ctx.app.gateway.webhookEndpoints.disable({
              organizationId: input.organizationId,
              endpointId: input.endpointId,
            }),
          ),
        ),

      archive: policy("webhookEndpoints:manage")(procedure.input(endpointInput))
        .use(async ({ input, next }) => {
          await plan(input);
          return next();
        })
        .mutation(({ ctx, input }) =>
          translating(() =>
            ctx.app.gateway.webhookEndpoints.archive({
              organizationId: input.organizationId,
              endpointId: input.endpointId,
            }),
          ),
        ),
    });
  }
}
