/**
 * The agent's wire under `/api/staff-access` (ADR-202), behind the `staff_access` door. A
 * requester key asks, checks, withdraws, redeems and ends; an ops token reads the `ops:read`
 * allowlist and calls the functions its approval named. Spec: staff-access-approval.feature
 */
import { anyAuthenticated } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  StaffAccessApi,
  staffAccessDoorSessionSchema,
  staffAccessEndedSchema,
  staffAccessFunctionAnswerSchema,
  staffAccessFunctionCallBodySchema,
  staffAccessFunctionListSchema,
  staffAccessFunctionParamsSchema,
  staffAccessWithdrawnSchema,
  staffAccessNoBodySchema,
  staffAccessOrganizationListSchema,
  staffAccessOrganizationParamsSchema,
  staffAccessOrganizationsQuerySchema,
  staffAccessQueueSummarySchema,
  staffAccessRedeemBodySchema,
  staffAccessRedeemedSchema,
  staffAccessRequestBodySchema,
  staffAccessRequestCreatedSchema,
  staffAccessRequestParamsSchema,
  staffAccessRequestStatusAnswerSchema,
  staffAccessUsageSchema,
} from "@langwatch/staff-access-contract";

const AGENT = anyAuthenticated({
  reason:
    "the bearer is an operator's enrolled agent or one approved session; each operation answers only that agent's own requests",
});
const FUNCTION_CALLER = anyAuthenticated({
  reason:
    "the bearer is one approved session's ops token; the operation runs only the functions that session's passkey approval named",
});
const OPS_READ = { at: "platform", refusal: "hidden" } as const;

export const staffAccessRest = defineRestRouter(StaffAccessApi)
  .withNamespace("staff-access")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: true })
  .withCredential("staff_access", { session: staffAccessDoorSessionSchema })

  .post("/api/staff-access/requests", "createStaffAccessRequest")
  .keepsRecords()
  .withoutAudit("the request row is the record; its approval is audited in the customer's log")
  .withInput(staffAccessRequestBodySchema)
  .withAccess(AGENT)
  .withOutput(staffAccessRequestCreatedSchema)
  .handle(({ app, session, input }) => app.createRequest({ session, body: input }))

  .get("/api/staff-access/requests/:requestId", "getStaffAccessRequest")
  .withParams(staffAccessRequestParamsSchema)
  .withAccess(AGENT)
  .withOutput(staffAccessRequestStatusAnswerSchema)
  .handle(({ app, session, input }) =>
    app.getRequestStatus({ session, requestId: input.requestId }),
  )

  .post("/api/staff-access/requests/:requestId/redeem", "redeemStaffAccessRequest")
  .keepsRecords()
  .withoutAudit("the redeem is recorded on the request row; every later call writes the trail")
  .withParams(staffAccessRequestParamsSchema)
  .withInput(staffAccessRedeemBodySchema)
  .withAccess(AGENT)
  .withOutput(staffAccessRedeemedSchema)
  .handle(({ app, session, input }) =>
    app.redeem({ session, requestId: input.requestId, codeVerifier: input.codeVerifier }),
  )

  .post("/api/staff-access/requests/:requestId/end", "endStaffAccessSession")
  .keepsRecords()
  .withoutAudit("the end is audited in the customer's log as staffAccess.revoked")
  .withParams(staffAccessRequestParamsSchema)
  .withInput(staffAccessNoBodySchema)
  .withAccess(AGENT)
  .withOutput(staffAccessEndedSchema)
  .handle(({ app, session, input }) => app.endSession({ session, requestId: input.requestId }))

  .post("/api/staff-access/requests/:requestId/withdraw", "withdrawStaffAccessRequest")
  .keepsRecords()
  .withoutAudit(
    "the withdraw is recorded on the request row; an undecided request has no customer row",
  )
  .withParams(staffAccessRequestParamsSchema)
  .withInput(staffAccessNoBodySchema)
  .withAccess(AGENT)
  .withOutput(staffAccessWithdrawnSchema)
  .handle(({ app, session, input }) => app.withdrawRequest({ session, requestId: input.requestId }))

  .get("/api/staff-access/functions", "listStaffAccessFunctions")
  .withAccess(AGENT)
  .withOutput(staffAccessFunctionListSchema)
  .handle(({ app, session }) => app.listFunctions({ session }))

  .post("/api/staff-access/functions/:functionName", "callStaffAccessFunction")
  .keepsRecords()
  .withoutAudit("read sent as a POST")
  .withParams(staffAccessFunctionParamsSchema)
  .withInput(staffAccessFunctionCallBodySchema)
  .withAccess(FUNCTION_CALLER)
  .withOutput(staffAccessFunctionAnswerSchema)
  .handle(({ app, session, input }) =>
    app.callFunction({ session, name: input.functionName, input: input.input }),
  )

  .get("/api/staff-access/ops/organizations", "listStaffAccessOrganizations")
  .withQuery(staffAccessOrganizationsQuerySchema)
  .withPermission("opsRead:view", OPS_READ)
  .withOutput(staffAccessOrganizationListSchema)
  .handle(({ app, session, input }) =>
    app.listOrganizations({
      session,
      ...(input.query ? { query: input.query } : {}),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(input.cursor ? { cursor: input.cursor } : {}),
    }),
  )

  .get("/api/staff-access/ops/organizations/:organization/usage", "getStaffAccessOrganizationUsage")
  .withParams(staffAccessOrganizationParamsSchema)
  .withPermission("opsRead:view", OPS_READ)
  .withOutput(staffAccessUsageSchema)
  .handle(({ app, session, input }) =>
    app.getOrganizationUsage({ session, organization: input.organization }),
  )

  .get("/api/staff-access/ops/queues", "getStaffAccessQueueSummary")
  .withPermission("opsRead:view", OPS_READ)
  .withOutput(staffAccessQueueSummarySchema)
  .handle(({ app, session }) => app.getQueueSummary({ session }))
  .build();
