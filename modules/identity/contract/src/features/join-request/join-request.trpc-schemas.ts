import type { Named } from "@langwatch/module";
import { z } from "zod";

import { DOMAIN_JOIN_SETTINGS } from "./join-matching.ts";
import { joinerRoleSchema } from "./join-request.responses.ts";
import { joinRequestOriginSchema } from "./join-request.ts";

/** Transport inputs: deliberately narrow to prevent probing for other organizations. */

/** The organization an admin-side call is about. */
const joinRequestApiOrganizationScopeSchemaDefinition = z.object({
  organizationId: z.string().min(1),
});
export interface JoinRequestApiOrganizationScopeSchema extends Named<
  typeof joinRequestApiOrganizationScopeSchemaDefinition
> {}
export const joinRequestApiOrganizationScopeSchema: JoinRequestApiOrganizationScopeSchema =
  joinRequestApiOrganizationScopeSchemaDefinition;
export type JoinRequestApiOrganizationScope = z.infer<typeof joinRequestApiOrganizationScopeSchema>;

/**
 * Where a request is made (ADR-171 v6), as the browser asserts it. Trusted
 * because it only LOWERS the seat; an older client naming nothing is `web`.
 */
const joinRequestApiOriginSchemaDefinition = joinRequestOriginSchema.default("web");
export interface JoinRequestApiOriginSchema extends Named<
  typeof joinRequestApiOriginSchemaDefinition
> {}
export const joinRequestApiOriginSchema: JoinRequestApiOriginSchema =
  joinRequestApiOriginSchemaDefinition;
export type JoinRequestApiOrigin = z.infer<typeof joinRequestApiOriginSchema>;

/** The organization being asked to let the caller in. */
const joinRequestApiRequestInputSchemaDefinition = z.object({
  organizationId: z.string().min(1),
  origin: joinRequestApiOriginSchema,
});
export interface JoinRequestApiRequestInputSchema extends Named<
  typeof joinRequestApiRequestInputSchemaDefinition
> {}
export const joinRequestApiRequestInputSchema: JoinRequestApiRequestInputSchema =
  joinRequestApiRequestInputSchemaDefinition;
export type JoinRequestApiRequestInput = z.infer<typeof joinRequestApiRequestInputSchema>;

const joinRequestApiAdmitInputSchemaDefinition = z.object({
  origin: joinRequestApiOriginSchema,
});
export interface JoinRequestApiAdmitInputSchema extends Named<
  typeof joinRequestApiAdmitInputSchemaDefinition
> {}
export const joinRequestApiAdmitInputSchema: JoinRequestApiAdmitInputSchema =
  joinRequestApiAdmitInputSchemaDefinition;

const joinRequestApiWithdrawInputSchemaDefinition = z.object({
  joinRequestId: z.string().min(1),
});
export interface JoinRequestApiWithdrawInputSchema extends Named<
  typeof joinRequestApiWithdrawInputSchemaDefinition
> {}
export const joinRequestApiWithdrawInputSchema: JoinRequestApiWithdrawInputSchema =
  joinRequestApiWithdrawInputSchemaDefinition;
export type JoinRequestApiWithdrawInput = z.infer<typeof joinRequestApiWithdrawInputSchema>;

/** One waiting request an admin is approving or rejecting. */
const joinRequestApiDecisionInputSchemaDefinition = z.object({
  organizationId: z.string().min(1),
  joinRequestId: z.string().min(1),
});
export interface JoinRequestApiDecisionInputSchema extends Named<
  typeof joinRequestApiDecisionInputSchemaDefinition
> {}
export const joinRequestApiDecisionInputSchema: JoinRequestApiDecisionInputSchema =
  joinRequestApiDecisionInputSchemaDefinition;
export type JoinRequestApiDecisionInput = z.infer<typeof joinRequestApiDecisionInputSchema>;

/** How colleagues on a matching domain get in, as an administrator saves it. */
const joinRequestApiSetJoiningInputSchemaDefinition = z.object({
  organizationId: z.string().min(1),
  domainJoin: z.enum(DOMAIN_JOIN_SETTINGS),
  domains: z.array(z.string().min(1)).default([]),
  joinerRole: joinerRoleSchema.optional(),
});
export interface JoinRequestApiSetJoiningInputSchema extends Named<
  typeof joinRequestApiSetJoiningInputSchemaDefinition
> {}
export const joinRequestApiSetJoiningInputSchema: JoinRequestApiSetJoiningInputSchema =
  joinRequestApiSetJoiningInputSchemaDefinition;
export type JoinRequestApiSetJoiningInput = z.infer<typeof joinRequestApiSetJoiningInputSchema>;

/** The members whose provenance the members area is showing; the answer covers no one else. */
const joinRequestApiAdmissionsInputSchemaDefinition = z.object({
  organizationId: z.string().min(1),
  userIds: z.array(z.string().min(1)),
});
export interface JoinRequestApiAdmissionsInputSchema extends Named<
  typeof joinRequestApiAdmissionsInputSchemaDefinition
> {}
export const joinRequestApiAdmissionsInputSchema: JoinRequestApiAdmissionsInputSchema =
  joinRequestApiAdmissionsInputSchemaDefinition;
export type JoinRequestApiAdmissionsInput = z.infer<typeof joinRequestApiAdmissionsInputSchema>;
