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
import { createTrpcService, type TrpcPolicyDecorator } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  WEBHOOK_EVENT_TYPES,
  webhookDeliveryPageSchema,
  webhookDestinationKindSchema,
  webhookEndpointHealthSchema,
  webhookEndpointViewSchema,
  webhookEndpointWithSecretSchema,
  webhookEventTypeSchema,
} from "@langwatch/enterprise-webhook-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import type { WebhookApp } from "#app/webhook.app";
import { fromDate, toDate } from "@langwatch/time";

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
  policy(permission: AuthzPermission): TrpcPolicyDecorator;
  /**
   * The Enterprise entitlement gate, already built by the process and applied
   * AFTER the permission check, so membership is established when it runs —
   * exactly the order this surface has always had.
   */
  entitlementGate: TrpcPolicyDecorator;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
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
    const { protected: procedure, policy, entitlementGate, validateOutput } = procedures;

    // Nothing translates an error here. Every refusal this surface raises is
    // already a `HandledError` with the status it has always answered with: the
    // entitlement gate's is a 403, the endpoint's validation refusal a 400 and
    // its absence a 404, and the process's tRPC policy maps each to the code
    // the `TRPCError`s built here used to name.
    const entitled = (permission: AuthzPermission): TrpcPolicyDecorator => {
      const check = policy(permission);
      return (built) => entitlementGate(check(built));
    };
    const VIEW = "webhookEndpoints:view, then the Enterprise entitlement gate";
    const MANAGE = "webhookEndpoints:manage, then the Enterprise entitlement gate";

    return createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .query("eventTypes", (p) =>
        p
          .withInput(orgInput)
          .withOutput(webhookEventTypeSchema.array())
          .withCustomPermission(entitled("webhookEndpoints:view"), VIEW)
          /** The event catalog the drawer renders its checkboxes from. */
          .handle(() => WEBHOOK_EVENT_TYPES),
      )
      .query("list", (p) =>
        p
          .withInput(orgInput)
          .withOutput(webhookEndpointViewSchema.array())
          .withCustomPermission(entitled("webhookEndpoints:view"), VIEW)
          .handle(({ ctx, input }) =>
            ctx.app.webhooks.endpoints.getAll({ organizationId: input.organizationId }),
          ),
      )
      .query("deliveries", (p) =>
        p
          .withInput(
            endpointInput.extend({
              limit: z.number().int().min(1).max(200).optional(),
              cursor: z.object({ firedAt: z.coerce.date(), id: z.string() }).optional(),
            }),
          )
          .withOutput(webhookDeliveryPageSchema)
          .withCustomPermission(entitled("webhookEndpoints:view"), VIEW)
          .handle(async ({ ctx, input }) => {
            const page = await ctx.app.webhooks.endpoints.getDeliveries({
              organizationId: input.organizationId,
              endpointId: input.endpointId,
              limit: input.limit,
              cursor: input.cursor
                ? { firedAt: fromDate(input.cursor.firedAt), id: input.cursor.id }
                : undefined,
            });

            return {
              deliveries: page.deliveries.map((delivery) => ({
                ...delivery,
                firedAt: toDate(delivery.firedAt),
              })),
              nextCursor: page.nextCursor
                ? { firedAt: toDate(page.nextCursor.firedAt), id: page.nextCursor.id }
                : null,
            };
          }),
      )
      .mutation("create", (p) =>
        p
          .withInput(
            orgInput.extend({
              destinationKind: webhookDestinationKindSchema.optional(),
              url: z.string().optional(),
              sqs: sqsDestinationInput.optional(),
              enabledEvents: z.array(z.string()).min(1),
              maxBatchSize: z.number().int().optional(),
              maxBatchDelayMs: z.number().int().optional(),
              maxInFlight: z.number().int().optional(),
            }),
          )
          .withOutput(webhookEndpointWithSecretSchema)
          .withCustomPermission(entitled("webhookEndpoints:manage"), MANAGE)
          .handle(({ ctx, input }) =>
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
      )
      .query("health", (p) =>
        p
          .withInput(endpointInput)
          .withOutput(webhookEndpointHealthSchema)
          .withCustomPermission(entitled("webhookEndpoints:view"), VIEW)
          .handle(({ ctx, input }) =>
            ctx.app.webhooks.health.health({
              organizationId: input.organizationId,
              endpointId: input.endpointId,
            }),
          ),
      )
      .mutation("update", (p) =>
        p
          .withInput(
            endpointInput.extend({
              // Accepted only when it repeats the kind the endpoint already
              // has. Zod strips unknown keys, so leaving it out would silently
              // drop a caller's attempted kind change and answer success where
              // REST refuses: two surfaces, two answers to the same request.
              destinationKind: webhookDestinationKindSchema.optional(),
              url: z.string().optional(),
              sqs: sqsDestinationInput.partial().optional(),
              enabledEvents: z.array(z.string()).min(1).optional(),
              maxBatchSize: z.number().int().optional(),
              maxBatchDelayMs: z.number().int().optional(),
              maxInFlight: z.number().int().optional(),
            }),
          )
          .withOutput(webhookEndpointViewSchema)
          .withCustomPermission(entitled("webhookEndpoints:manage"), MANAGE)
          .handle(({ ctx, input }) =>
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
      )
      .mutation("rollSecret", (p) =>
        p
          .withInput(endpointInput)
          .withOutput(webhookEndpointWithSecretSchema)
          .withCustomPermission(entitled("webhookEndpoints:manage"), MANAGE)
          .handle(({ ctx, input }) =>
            ctx.app.webhooks.endpoints.rollSecret({
              organizationId: input.organizationId,
              endpointId: input.endpointId,
            }),
          ),
      )
      .mutation("enable", (p) =>
        p
          .withInput(endpointInput)
          .withOutput(webhookEndpointViewSchema)
          .withCustomPermission(entitled("webhookEndpoints:manage"), MANAGE)
          .handle(({ ctx, input }) =>
            ctx.app.webhooks.endpoints.enable({
              organizationId: input.organizationId,
              endpointId: input.endpointId,
            }),
          ),
      )
      .mutation("disable", (p) =>
        p
          .withInput(endpointInput)
          .withOutput(webhookEndpointViewSchema)
          .withCustomPermission(entitled("webhookEndpoints:manage"), MANAGE)
          .handle(({ ctx, input }) =>
            ctx.app.webhooks.endpoints.disable({
              organizationId: input.organizationId,
              endpointId: input.endpointId,
            }),
          ),
      )
      .mutation("archive", (p) =>
        p
          .withInput(endpointInput)
          .withOutput(z.void())
          .withCustomPermission(entitled("webhookEndpoints:manage"), MANAGE)
          .handle(({ ctx, input }) =>
            ctx.app.webhooks.endpoints.archive({
              organizationId: input.organizationId,
              endpointId: input.endpointId,
            }),
          ),
      )
      .build();
  }
}
