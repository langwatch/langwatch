/**
 * Every `staffAccess.*` procedure, declared once: the operator's agents page and approval page.
 * Every one answers `not_found` unless cloud ops and the feature flag are on.
 */
import { defineTrpcContract } from "@langwatch/module";
import { z } from "zod";

import {
  staffAccessApprovalChoiceSchema,
  staffAccessApprovalViewSchema,
  staffAccessApproveInputSchema,
  staffAccessAssertionOptionsSchema,
  staffAccessEnrolInputSchema,
  staffAccessEnrolledSchema,
  staffAccessOkSchema,
  staffAccessOverviewSchema,
  staffAccessRequestIdInputSchema,
  staffAccessRequesterIdInputSchema,
  staffAccessRevokeAllInputSchema,
  staffAccessRevokedCountSchema,
} from "./staff-access.ts";

export const staffAccessTrpc = defineTrpcContract("staffAccess")
  .query("overview")
  .withInput(z.void())
  .withOutput(staffAccessOverviewSchema)

  .mutation("enrolOptions")
  .withInput(z.void())
  .withOutput(staffAccessAssertionOptionsSchema)

  .mutation("enrol")
  .withInput(staffAccessEnrolInputSchema)
  .withOutput(staffAccessEnrolledSchema)

  .mutation("revokeRequester")
  .withInput(staffAccessRequesterIdInputSchema)
  .withOutput(staffAccessOkSchema)

  .query("getApprovalRequest")
  .withInput(staffAccessRequestIdInputSchema)
  .withOutput(staffAccessApprovalViewSchema)

  .mutation("approvalOptions")
  .withInput(staffAccessApprovalChoiceSchema)
  .withOutput(staffAccessAssertionOptionsSchema)

  .mutation("approve")
  .withInput(staffAccessApproveInputSchema)
  .withOutput(staffAccessApprovalViewSchema)

  .mutation("deny")
  .withInput(staffAccessRequestIdInputSchema)
  .withOutput(staffAccessApprovalViewSchema)

  .mutation("revokeSession")
  .withInput(staffAccessRequestIdInputSchema)
  .withOutput(staffAccessOkSchema)

  .mutation("revokeAll")
  .withInput(staffAccessRevokeAllInputSchema)
  .withOutput(staffAccessRevokedCountSchema)
  .build();
