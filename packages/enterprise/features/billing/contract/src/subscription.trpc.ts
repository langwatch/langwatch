/**
 * Every `subscription.*` procedure, declared once. The names are the browser's
 * cache keys, so they are the wire names the billing page has always called.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  billingDisplayInvoiceSchema,
  billingPortalSessionSchema,
  billingRedirectSchema,
  subscriptionItemsUpdatedSchema,
} from "./billing-types.ts";
import { SUBSCRIBABLE_PLANS } from "./plan-types.ts";
import { currencySchema } from "./pricing.ts";

/** The organization whose subscription is being read or changed. */
const organizationScopeSchema = z.object({ organizationId: z.string() });

/** The plans a customer may put themselves on without talking to anybody. */
export const subscribablePlanSchema = z.enum(SUBSCRIBABLE_PLANS);
export type SubscribablePlan = z.infer<typeof subscribablePlanSchema>;

/** How often the customer is invoiced for what they just bought. */
export const subscriptionBillingIntervalSchema = z.enum(["monthly", "annual"]);
export type SubscriptionBillingInterval = z.infer<typeof subscriptionBillingIntervalSchema>;

/** One invitation a checkout was started to pay a seat for. */
export const subscriptionInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "MEMBER", "EXTERNAL"]),
});
export type SubscriptionInvite = z.infer<typeof subscriptionInviteSchema>;

/**
 * Three of these answer the billing provider's own object, unchanged: naming
 * its shape here would drift the first time the provider adds a field.
 */
const providerOwnedSchema = z.unknown();

export const subscriptionTrpc = defineTrpcContract("subscription")
  .mutation("addTeamMemberOrEvents")
  .withInput(
    z.object({
      ...organizationScopeSchema.shape,
      plan: subscribablePlanSchema,
      upgradeMembers: z.boolean(),
      upgradeTraces: z.boolean(),
      totalMembers: z.number(),
      totalTraces: z.number(),
      // Echoed back from `previewProration` so the charge prices the same
      // instant the customer was quoted. Optional: a caller that never showed
      // a quote is priced at the moment they run.
      quotedAt: z.number().int().positive().optional(),
    }),
  )
  .withOutput(subscriptionItemsUpdatedSchema)

  .mutation("create")
  .withInput(
    z.object({
      ...organizationScopeSchema.shape,
      baseUrl: z.string(),
      plan: subscribablePlanSchema,
      membersToAdd: z.number().optional(),
      tracesToAdd: z.number().optional(),
      currency: currencySchema.optional(),
      billingInterval: subscriptionBillingIntervalSchema.optional(),
    }),
  )
  .withOutput(billingRedirectSchema)

  .mutation("manage")
  .withInput(z.object({ ...organizationScopeSchema.shape, baseUrl: z.string() }))
  .withOutput(billingPortalSessionSchema)

  .query("previewProration")
  .withInput(z.object({ ...organizationScopeSchema.shape, newTotalSeats: z.number().min(1) }))
  .withOutput(providerOwnedSchema)

  .query("getLastSubscription")
  .withInput(organizationScopeSchema)
  .withOutput(providerOwnedSchema)

  .mutation("upgradeWithInvites")
  .withInput(
    z.object({
      ...organizationScopeSchema.shape,
      baseUrl: z.string(),
      currency: currencySchema.optional(),
      billingInterval: subscriptionBillingIntervalSchema.optional(),
      totalSeats: z.number().min(1),
      invites: z.array(subscriptionInviteSchema),
    }),
  )
  .withOutput(billingRedirectSchema)

  .mutation("prospective")
  .withInput(
    z.object({
      ...organizationScopeSchema.shape,
      plan: subscribablePlanSchema,
      customerName: z.string().optional(),
      customerEmail: z.string().email().optional(),
      note: z.string().optional(),
    }),
  )
  // The notification channel's own acknowledgement; nothing on this surface
  // reads it, and it is carried unchanged so the wire does not move.
  .withOutput(providerOwnedSchema)

  .query("listInvoices")
  .withInput(organizationScopeSchema)
  .withOutput(billingDisplayInvoiceSchema.array())
  .build();
