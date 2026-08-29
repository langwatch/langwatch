/**
 * Webhook endpoint administration over the process's tRPC transport.
 *
 * The session-authenticated sibling of the organization-key REST surface at
 * /api/webhooks/v1: same service, same RBAC scopes
 * (`webhookEndpoints:view` | `:manage`), same enterprise plan gate.
 *
 * The surface belongs to the webhook feature rather than to the gateway. The
 * process used to park the endpoint and health capabilities under
 * `app.gateway` and this context mirrored that, which put a webhook surface
 * behind a gateway key: the service, the views, the delivery controls and
 * every refusal here are the webhook contract's, and none of them mention a
 * virtual key or a budget. It now reaches its own application instead, the
 * same one the REST family at /api/webhooks/v1 is given.
 *
 * ## Credentials
 *
 * The signing secret crosses to the client exactly twice — in the `create` and
 * `rollSecret` responses — and once each time. Every read path answers endpoint
 * views with no secret material.
 *
 * Transport only: input parsing, the entitlement gate, and delegation.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  WEBHOOK_EVENT_TYPES,
  webhookDestinationKindSchema,
} from "@langwatch/enterprise-webhook-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import type { WebhookApp } from "#app/webhook.app";

/**
 * The process supplies authentication; authorization arrives as `policy`.
 *
 * `app` is the slice of the process's application this feature reaches. It is
 * keyed on the feature rather than on `gateway`, where the process used to
 * park the endpoint and health capabilities: the service, the views, the
 * delivery controls and every refusal here are the webhook contract's, and
 * none of them mention a virtual key or a budget. The REST family, built per
 * family, holds the same {@link WebhookApp} directly.
 */
export type WebhookEndpointTrpcContext = Readonly<{
  app: Readonly<{ webhooks: WebhookApp }>;
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
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: WebhookEndpointTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy } = procedures;

    // The plan gate is installed at each procedure AFTER the RBAC check, so
    // membership is already established when it runs — exactly the order this
    // surface has always had.
    //
    // Nothing translates an error here any more. Every refusal this surface
    // raises is already a `HandledError` with the status it has always
    // answered with: the entitlement gate's is a 403, the endpoint's
    // validation refusal a 400 and its absence a 404, and the process's tRPC
    // policy maps each to the code the `TRPCError`s built here used to name.
    return trpc.router({
      /** The event catalog the drawer renders its checkboxes from. */
      eventTypes: policy("webhookEndpoints:view")(procedure.input(orgInput))
        .use(async ({ ctx, input, next }) => {
          await ctx.app.webhooks.assertEntitled(input.organizationId);
          return next();
        })
        .query(() => WEBHOOK_EVENT_TYPES),

      list: policy("webhookEndpoints:view")(procedure.input(orgInput))
        .use(async ({ ctx, input, next }) => {
          await ctx.app.webhooks.assertEntitled(input.organizationId);
          return next();
        })
        .query(({ ctx, input }) =>
          ctx.app.webhooks.endpoints.getAll({ organizationId: input.organizationId }),
        ),

      deliveries: policy("webhookEndpoints:view")(
        procedure.input(
          endpointInput.extend({
            limit: z.number().int().min(1).max(200).optional(),
            cursor: z.object({ firedAt: z.coerce.date(), id: z.string() }).optional(),
          }),
        ),
      )
        .use(async ({ ctx, input, next }) => {
          await ctx.app.webhooks.assertEntitled(input.organizationId);
          return next();
        })
        .query(({ ctx, input }) =>
          ctx.app.webhooks.endpoints.getDeliveries({
            organizationId: input.organizationId,
            endpointId: input.endpointId,
            limit: input.limit,
            cursor: input.cursor,
          }),
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
        .use(async ({ ctx, input, next }) => {
          await ctx.app.webhooks.assertEntitled(input.organizationId);
          return next();
        })
        .mutation(({ ctx, input }) =>
          ctx.app.webhooks.endpoints.create({
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

      health: policy("webhookEndpoints:view")(procedure.input(endpointInput))
        .use(async ({ ctx, input, next }) => {
          await ctx.app.webhooks.assertEntitled(input.organizationId);
          return next();
        })
        .query(({ ctx, input }) =>
          ctx.app.webhooks.health.health({
            organizationId: input.organizationId,
            endpointId: input.endpointId,
          }),
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
        .use(async ({ ctx, input, next }) => {
          await ctx.app.webhooks.assertEntitled(input.organizationId);
          return next();
        })
        .mutation(({ ctx, input }) =>
          ctx.app.webhooks.endpoints.update({
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

      rollSecret: policy("webhookEndpoints:manage")(procedure.input(endpointInput))
        .use(async ({ ctx, input, next }) => {
          await ctx.app.webhooks.assertEntitled(input.organizationId);
          return next();
        })
        .mutation(({ ctx, input }) =>
          ctx.app.webhooks.endpoints.rollSecret({
            organizationId: input.organizationId,
            endpointId: input.endpointId,
          }),
        ),

      enable: policy("webhookEndpoints:manage")(procedure.input(endpointInput))
        .use(async ({ ctx, input, next }) => {
          await ctx.app.webhooks.assertEntitled(input.organizationId);
          return next();
        })
        .mutation(({ ctx, input }) =>
          ctx.app.webhooks.endpoints.enable({
            organizationId: input.organizationId,
            endpointId: input.endpointId,
          }),
        ),

      disable: policy("webhookEndpoints:manage")(procedure.input(endpointInput))
        .use(async ({ ctx, input, next }) => {
          await ctx.app.webhooks.assertEntitled(input.organizationId);
          return next();
        })
        .mutation(({ ctx, input }) =>
          ctx.app.webhooks.endpoints.disable({
            organizationId: input.organizationId,
            endpointId: input.endpointId,
          }),
        ),

      archive: policy("webhookEndpoints:manage")(procedure.input(endpointInput))
        .use(async ({ ctx, input, next }) => {
          await ctx.app.webhooks.assertEntitled(input.organizationId);
          return next();
        })
        .mutation(({ ctx, input }) =>
          ctx.app.webhooks.endpoints.archive({
            organizationId: input.organizationId,
            endpointId: input.endpointId,
          }),
        ),
    });
  }
}
