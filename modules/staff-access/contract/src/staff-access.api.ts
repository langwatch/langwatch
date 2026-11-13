import type { PasskeyAssertionOptions, PasskeyAssertionResponse } from "@langwatch/auth-contract";
import { moduleApi, type Named } from "@langwatch/module";
import { z } from "zod";

import type {
  StaffAccessOrganizationList,
  StaffAccessQueueSummary,
  StaffAccessRedeemed,
  StaffAccessRequestBody,
  StaffAccessRequestCreated,
  StaffAccessRequestStatusAnswer,
  StaffAccessUsage,
} from "./staff-access-rest.schemas.ts";
import {
  staffAccessScopeSchema,
  type StaffAccessApprovalChoice,
  type StaffAccessApprovalView,
  type StaffAccessEnrolled,
  type StaffAccessOverview,
} from "./staff-access.ts";

/** Whoever called a `staffAccess.*` procedure, as the session door resolved them. */
export type StaffAccessActor = Readonly<{ type: string; id?: string; impersonatorId?: string }>;

/**
 * What the `staff_access` door hands a route: the requester an `lwsr_` key stands for, or the
 * session an `lwsa_` ops token stands for, with the address the call came from.
 */
const staffAccessDoorSessionSchemaDefinition = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("requester"),
    requesterId: z.string(),
    ownerUserId: z.string(),
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("ops"),
    requestId: z.string(),
    scopes: z.array(staffAccessScopeSchema),
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
  }),
]);
export interface StaffAccessDoorSessionSchema extends Named<
  typeof staffAccessDoorSessionSchemaDefinition
> {}
export const staffAccessDoorSessionSchema: StaffAccessDoorSessionSchema =
  staffAccessDoorSessionSchemaDefinition;
export type StaffAccessDoorSession = z.infer<typeof staffAccessDoorSessionSchema>;

/** Who an operator-side operation answers for. */
export type StaffAccessOperator = Readonly<{ actor: StaffAccessActor }>;
/** Who an agent-side operation answers for: the session the door resolved. */
export type StaffAccessAgent = Readonly<{ session: StaffAccessDoorSession }>;

export interface StaffAccessApi {
  /** The signed-in operator's agents, whether they hold a passkey, and every recent session. */
  overview(input: StaffAccessOperator): Promise<StaffAccessOverview>;
  /** Stores an enrolment challenge; refuses `passkey_required` without a passkey. */
  enrolOptions(input: StaffAccessOperator): Promise<PasskeyAssertionOptions>;
  /** Verifies the passkey over the stored challenge and mints a 90-day requester key, once. */
  enrol(
    input: StaffAccessOperator & { name: string; assertion: PasskeyAssertionResponse },
  ): Promise<StaffAccessEnrolled>;
  revokeRequester(input: StaffAccessOperator & { requesterId: string }): Promise<{ ok: true }>;
  /** Only the requester's owner sees a request; anyone else gets `not_found`. */
  getApprovalRequest(
    input: StaffAccessOperator & { requestId: string },
  ): Promise<StaffAccessApprovalView>;
  /** The ceremony over the hash of exactly what the page shows and the operator chose. */
  approvalOptions(
    input: StaffAccessOperator & StaffAccessApprovalChoice,
  ): Promise<PasskeyAssertionOptions>;
  approve(
    input: StaffAccessOperator &
      StaffAccessApprovalChoice & { assertion: PasskeyAssertionResponse },
  ): Promise<StaffAccessApprovalView>;
  deny(input: StaffAccessOperator & { requestId: string }): Promise<StaffAccessApprovalView>;
  revokeSession(input: StaffAccessOperator & { requestId: string }): Promise<{ ok: true }>;
  /** The kill switch: every live session, after the typed confirmation. */
  revokeAll(
    input: StaffAccessOperator & { confirmation: string },
  ): Promise<{ revoked: number; failed: number }>;

  createRequest(
    input: StaffAccessAgent & { body: StaffAccessRequestBody },
  ): Promise<StaffAccessRequestCreated>;
  getRequestStatus(
    input: StaffAccessAgent & { requestId: string },
  ): Promise<StaffAccessRequestStatusAnswer>;
  redeem(
    input: StaffAccessAgent & { requestId: string; codeVerifier: string },
  ): Promise<StaffAccessRedeemed>;
  endSession(input: StaffAccessAgent & { requestId: string }): Promise<{ ended: true }>;

  listOrganizations(
    input: StaffAccessAgent & { query?: string },
  ): Promise<StaffAccessOrganizationList>;
  getOrganizationUsage(
    input: StaffAccessAgent & { organization: string },
  ): Promise<StaffAccessUsage>;
  getQueueSummary(input: StaffAccessAgent): Promise<StaffAccessQueueSummary>;

  /** Audits every session whose hour passed with no revoke, once each. */
  sweepExpiredSessions(input: { at: number }): Promise<{ audited: number }>;
}

export const StaffAccessApi = moduleApi<StaffAccessApi>()("staff-access");
