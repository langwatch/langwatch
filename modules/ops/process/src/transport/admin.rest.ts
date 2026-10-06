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
  type OpsOperator,
} from "@langwatch/ops-contract";

export const adminAuthSession = defineRestMiddleware("adminAuthSession", adminAuthSessionSchema);
export const adminAuditRequest = defineRestMiddleware("adminAuditRequest", adminAuditRequestSchema);

/** The operator the door admitted, as the back office reads it: who acts, and for whom. */
function operatorOf(actor: { id: string; impersonatorId?: string }): OpsOperator {
  return actor.impersonatorId
    ? { id: actor.id, impersonator: { id: actor.impersonatorId } }
    : { id: actor.id };
}

export const adminRest = defineRestRouter(OpsApi)
  .withNamespace("admin")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: true })

  .post("/api/admin/impersonate", "startAdminImpersonation")
  .withInput(adminImpersonationRequestSchema)
  .withCredential("browser")
  .withPermission("ops:manage", { at: "platform", refusal: "hidden" })
  .withOutput(adminImpersonationStartedSchema)
  .withMiddleware(adminAuthSession, adminAuditRequest)
  .handle(({ app, input, actor }, ...[session, req]) =>
    app.startAdminImpersonation({ ...input, actor: operatorOf(actor), session, req }),
  )

  .delete("/api/admin/impersonate", "stopAdminImpersonation")
  .withInput(adminEmptyRequestSchema)
  .withCredential("browser")
  .withPermission("ops:manage", { at: "platform", refusal: "hidden" })
  .withOutput(adminImpersonationStoppedSchema)
  .withMiddleware(adminAuthSession, adminAuditRequest)
  .handle(({ app, actor }, ...[session, req]) =>
    app.stopAdminImpersonation({ actor: operatorOf(actor), session, req }),
  )

  .post("/api/admin/:resource", "runAdminOperation")
  .withParams(adminResourceParamsSchema)
  .withInput(adminOperationBodySchema)
  .withCredential("browser")
  // A write method also needs ops:manage, which the application asks (the method is in the body).
  .withPermission("ops:view", { at: "platform", refusal: "hidden" })
  .withOutput(adminOperationResponseSchema)
  .withMiddleware(adminAuditRequest)
  .handle(({ app, input, actor }, req) =>
    app.runAdminOperation({ ...input, actor: operatorOf(actor), req }),
  )
  .build();
