/**
 * Staff access (ADR-202): an operator's coding agent asks for one hour of access, the operator
 * approves each request with a passkey, the agent redeems once. These are the shapes the
 * operator's pages read. Spec: modules/staff-access/specs/staff-access-approval.feature
 */
import {
  passkeyAssertionOptionsSchema,
  passkeyAssertionResponseSchema,
} from "@langwatch/auth-contract";
import { STAFF_ACCESS_SCOPES } from "@langwatch/authz-contract";
import type { Named } from "@langwatch/module";
import { z } from "zod";

/** The system flag that, with cloud ops, opens every staff access surface. */
export const STAFF_ACCESS_FLAG = "ops_agent_access_enabled" as const;

/** Requester keys start with this; ops tokens with {@link STAFF_ACCESS_OPS_TOKEN_PREFIX}. */
export const STAFF_ACCESS_REQUESTER_KEY_PREFIX = "lwsr_" as const;
export const STAFF_ACCESS_OPS_TOKEN_PREFIX = "lwsa_" as const;

/** What the operator types to revoke every live session at once. */
export const STAFF_ACCESS_REVOKE_ALL_CONFIRMATION = "revoke all" as const;

/** The audit-log principal a staff session acts as, whatever its scopes. */
export const STAFF_ACCESS_PRINCIPAL = "LangWatch Support" as const;

export const STAFF_ACCESS_REASON_MAX_LENGTH = 500;
export const STAFF_ACCESS_MACHINE_MAX_LENGTH = 200;
export const STAFF_ACCESS_REQUESTER_NAME_MAX_LENGTH = 80;

export const staffAccessScopeSchema = z.enum(STAFF_ACCESS_SCOPES);
export type StaffAccessScopeName = z.infer<typeof staffAccessScopeSchema>;

export const staffAccessRequestStatusSchema = z.enum([
  "pending",
  "approved",
  "denied",
  "redeemed",
  "expired",
  "revoked",
]);
export type StaffAccessRequestStatus = z.infer<typeof staffAccessRequestStatusSchema>;

/** One enrolled agent of the signed-in operator; the key itself is shown only at enrolment. */
const staffAccessRequesterViewSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export interface StaffAccessRequesterViewSchema extends Named<
  typeof staffAccessRequesterViewSchemaDefinition
> {}
export const staffAccessRequesterViewSchema: StaffAccessRequesterViewSchema =
  staffAccessRequesterViewSchemaDefinition;
export type StaffAccessRequesterView = z.infer<typeof staffAccessRequesterViewSchema>;

/** One request or session, as the operator console and the approval page show it. */
const staffAccessSessionViewSchemaDefinition = z.object({
  requestId: z.string(),
  status: staffAccessRequestStatusSchema,
  scopes: z.array(staffAccessScopeSchema),
  organizationId: z.string().nullable(),
  organizationName: z.string().nullable(),
  reason: z.string(),
  machine: z.string(),
  requestIp: z.string().nullable(),
  requesterName: z.string(),
  ownerUserId: z.string(),
  ownerEmail: z.string().nullable(),
  spendApproved: z.boolean(),
  createdAt: z.string(),
  /** When an undecided request lapses. */
  expiresAt: z.string(),
  approvedAt: z.string().nullable(),
  redeemedAt: z.string().nullable(),
  /** When a redeemed session's key stops working. */
  accessExpiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export interface StaffAccessSessionViewSchema extends Named<
  typeof staffAccessSessionViewSchemaDefinition
> {}
export const staffAccessSessionViewSchema: StaffAccessSessionViewSchema =
  staffAccessSessionViewSchemaDefinition;
export type StaffAccessSessionView = z.infer<typeof staffAccessSessionViewSchema>;

/** The approval page: the request plus what the ceremony will ask of the operator. */
const staffAccessApprovalViewSchemaDefinition = z.object({
  ...staffAccessSessionViewSchemaDefinition.shape,
  /** Whether approving needs the organization name typed, with and without the spend tick. */
  typedNameRequired: z.object({ withSpend: z.boolean(), withoutSpend: z.boolean() }),
  /** Spend can be ticked only for a support request. */
  spendOffered: z.boolean(),
});
export interface StaffAccessApprovalViewSchema extends Named<
  typeof staffAccessApprovalViewSchemaDefinition
> {}
export const staffAccessApprovalViewSchema: StaffAccessApprovalViewSchema =
  staffAccessApprovalViewSchemaDefinition;
export type StaffAccessApprovalView = z.infer<typeof staffAccessApprovalViewSchema>;

const staffAccessOverviewSchemaDefinition = z.object({
  hasPasskey: z.boolean(),
  requesters: z.array(staffAccessRequesterViewSchema),
  /** Live and recent sessions across every operator, newest first. */
  sessions: z.array(staffAccessSessionViewSchema),
});
export interface StaffAccessOverviewSchema extends Named<
  typeof staffAccessOverviewSchemaDefinition
> {}
export const staffAccessOverviewSchema: StaffAccessOverviewSchema =
  staffAccessOverviewSchemaDefinition;
export type StaffAccessOverview = z.infer<typeof staffAccessOverviewSchema>;

export const staffAccessAssertionOptionsSchema = passkeyAssertionOptionsSchema;

const staffAccessEnrolInputSchemaDefinition = z.object({
  name: z.string().trim().min(1).max(STAFF_ACCESS_REQUESTER_NAME_MAX_LENGTH),
  assertion: passkeyAssertionResponseSchema,
});
export interface StaffAccessEnrolInputSchema extends Named<
  typeof staffAccessEnrolInputSchemaDefinition
> {}
export const staffAccessEnrolInputSchema: StaffAccessEnrolInputSchema =
  staffAccessEnrolInputSchemaDefinition;
export type StaffAccessEnrolInput = z.infer<typeof staffAccessEnrolInputSchema>;

/** The enrolment's answer: the requester key, shown this once and never again. */
const staffAccessEnrolledSchemaDefinition = z.object({
  requesterKey: z.string(),
  requester: staffAccessRequesterViewSchema,
});
export interface StaffAccessEnrolledSchema extends Named<
  typeof staffAccessEnrolledSchemaDefinition
> {}
export const staffAccessEnrolledSchema: StaffAccessEnrolledSchema =
  staffAccessEnrolledSchemaDefinition;
export type StaffAccessEnrolled = z.infer<typeof staffAccessEnrolledSchema>;

const staffAccessRequesterIdInputSchemaDefinition = z.object({ requesterId: z.string().min(1) });
export interface StaffAccessRequesterIdInputSchema extends Named<
  typeof staffAccessRequesterIdInputSchemaDefinition
> {}
export const staffAccessRequesterIdInputSchema: StaffAccessRequesterIdInputSchema =
  staffAccessRequesterIdInputSchemaDefinition;
const staffAccessRequestIdInputSchemaDefinition = z.object({ requestId: z.string().min(1) });
export interface StaffAccessRequestIdInputSchema extends Named<
  typeof staffAccessRequestIdInputSchemaDefinition
> {}
export const staffAccessRequestIdInputSchema: StaffAccessRequestIdInputSchema =
  staffAccessRequestIdInputSchemaDefinition;

/** What the operator decided on the page: the spend tick and the typed organization name. */
const staffAccessApprovalChoiceSchemaDefinition = z.object({
  requestId: z.string().min(1),
  spendApproved: z.boolean(),
  typedOrganizationName: z.string().max(500).optional(),
});
export interface StaffAccessApprovalChoiceSchema extends Named<
  typeof staffAccessApprovalChoiceSchemaDefinition
> {}
export const staffAccessApprovalChoiceSchema: StaffAccessApprovalChoiceSchema =
  staffAccessApprovalChoiceSchemaDefinition;
export type StaffAccessApprovalChoice = z.infer<typeof staffAccessApprovalChoiceSchema>;

const staffAccessApproveInputSchemaDefinition = z.object({
  ...staffAccessApprovalChoiceSchemaDefinition.shape,
  assertion: passkeyAssertionResponseSchema,
});
export interface StaffAccessApproveInputSchema extends Named<
  typeof staffAccessApproveInputSchemaDefinition
> {}
export const staffAccessApproveInputSchema: StaffAccessApproveInputSchema =
  staffAccessApproveInputSchemaDefinition;
export type StaffAccessApproveInput = z.infer<typeof staffAccessApproveInputSchema>;

const staffAccessRevokeAllInputSchemaDefinition = z.object({ confirmation: z.string() });
export interface StaffAccessRevokeAllInputSchema extends Named<
  typeof staffAccessRevokeAllInputSchemaDefinition
> {}
export const staffAccessRevokeAllInputSchema: StaffAccessRevokeAllInputSchema =
  staffAccessRevokeAllInputSchemaDefinition;
const staffAccessRevokedCountSchemaDefinition = z.object({ revoked: z.number().int() });
export interface StaffAccessRevokedCountSchema extends Named<
  typeof staffAccessRevokedCountSchemaDefinition
> {}
export const staffAccessRevokedCountSchema: StaffAccessRevokedCountSchema =
  staffAccessRevokedCountSchemaDefinition;
const staffAccessOkSchemaDefinition = z.object({ ok: z.literal(true) });
export interface StaffAccessOkSchema extends Named<typeof staffAccessOkSchemaDefinition> {}
export const staffAccessOkSchema: StaffAccessOkSchema = staffAccessOkSchemaDefinition;
