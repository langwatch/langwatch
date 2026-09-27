import { publicRoute } from "@langwatch/api/access";
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import {
  adminAuditRequestSchema,
  adminAuthSessionSchema,
  adminEmptyRequestSchema,
  adminImpersonationRequestSchema,
  adminImpersonationStartedSchema,
  adminImpersonationStoppedSchema,
  adminOperationBodySchema,
  adminOperationResponseSchema,
  adminResourceParamsSchema,
  OpsApi,
  opsOperatorSchema,
} from "@langwatch/ops-contract";

export const adminActor = defineRestMiddleware("adminActor", opsOperatorSchema.nullable());
export const adminAuthSession = defineRestMiddleware("adminAuthSession", adminAuthSessionSchema);
export const adminAuditRequest = defineRestMiddleware("adminAuditRequest", adminAuditRequestSchema);

const STAFF_RESOLVED_IN_HANDLER =
  "the back office's browser session is resolved by the route itself, which answers its " +
  "own refusals; staff is instance membership rather than an RBAC grain, so no API " +
  "credential opens this door and no permission describes it";

export const adminRest = defineRestRouter(OpsApi)
  .withNamespace("admin")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: true })

  .post("/api/admin/impersonate", "startAdminImpersonation")
  .withInput(adminImpersonationRequestSchema)
  .withAccess(publicRoute({ reason: STAFF_RESOLVED_IN_HANDLER }))
  .withOutput(adminImpersonationStartedSchema)
  .withMiddleware(adminActor, adminAuthSession, adminAuditRequest)
  .handle(({ app, input }, ...[actor, session, req]) =>
    app.startAdminImpersonation({ ...input, actor, session, req }),
  )

  .delete("/api/admin/impersonate", "stopAdminImpersonation")
  .withInput(adminEmptyRequestSchema)
  .withAccess(publicRoute({ reason: STAFF_RESOLVED_IN_HANDLER }))
  .withOutput(adminImpersonationStoppedSchema)
  .withMiddleware(adminActor, adminAuthSession, adminAuditRequest)
  .handle(({ app }, ...[actor, session, req]) =>
    app.stopAdminImpersonation({ actor, session, req }),
  )

  .post("/api/admin/:resource", "runAdminOperation")
  .withParams(adminResourceParamsSchema)
  .withInput(adminOperationBodySchema)
  .withAccess(publicRoute({ reason: STAFF_RESOLVED_IN_HANDLER }))
  .withOutput(adminOperationResponseSchema)
  .withMiddleware(adminActor, adminAuditRequest)
  .handle(({ app, input }, actor, req) => app.runAdminOperation({ ...input, actor, req }))
  .build();
