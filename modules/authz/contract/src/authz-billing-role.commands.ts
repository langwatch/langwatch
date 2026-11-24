import { ledgerActorSchema, SYSTEM_ACTORS } from "@langwatch/authorization";
import type { Named } from "@langwatch/module";
/**
 * The Billing role's two operations (specs/licensing/billing-role.feature): who holds it in an
 * organization, and granting or revoking it for one member. The route asks the permission.
 */
import { z } from "zod";

import { authzGrantCallerSchema } from "./authz.commands.ts";

const authzListBillingMembersInputSchemaDefinition = z
  .object({ organizationId: z.string().min(1) })
  .strict();
export interface AuthzListBillingMembersInputSchema extends Named<
  typeof authzListBillingMembersInputSchemaDefinition
> {}
export const authzListBillingMembersInputSchema: AuthzListBillingMembersInputSchema =
  authzListBillingMembersInputSchemaDefinition;
export type AuthzListBillingMembersInput = z.infer<typeof authzListBillingMembersInputSchema>;

/** One live holder on an enabled membership, oldest grant first. */
const authzBillingMemberSchemaDefinition = z.object({ userId: z.string().min(1) }).strict();
export interface AuthzBillingMemberSchema extends Named<
  typeof authzBillingMemberSchemaDefinition
> {}
export const authzBillingMemberSchema: AuthzBillingMemberSchema =
  authzBillingMemberSchemaDefinition;
export type AuthzBillingMember = z.infer<typeof authzBillingMemberSchema>;

const authzSetBillingRoleInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    userId: z.string().min(1),
    /** True grants the role (a holder keeps the grant they have); false revokes every one. */
    holds: z.boolean(),
    /** The escalation ceiling: a person or key never grants or takes away what it lacks. */
    caller: authzGrantCallerSchema,
    actor: ledgerActorSchema,
    /** A retry passes the id it sent first; absent, the writer mints one. */
    commandId: z.string().min(1).optional(),
    /** `checkout` when finishing a checkout granted it; an administrator's toggle otherwise. */
    source: z.enum(["grants-service", "checkout"]).optional(),
  })
  .strict();
export interface AuthzSetBillingRoleInputSchema extends Named<
  typeof authzSetBillingRoleInputSchemaDefinition
> {}
export const authzSetBillingRoleInputSchema: AuthzSetBillingRoleInputSchema =
  authzSetBillingRoleInputSchemaDefinition;
export type AuthzSetBillingRoleInput = z.infer<typeof authzSetBillingRoleInputSchema>;

/** The actor a completed checkout writes its Billing grant as. */
export const BILLING_CHECKOUT_ACTOR = {
  type: "system",
  id: SYSTEM_ACTORS.billingCheckout,
} as const;
