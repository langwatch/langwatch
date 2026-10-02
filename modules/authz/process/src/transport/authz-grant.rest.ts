// `/api/grants`: who holds which role where, succeeding `/api/role-bindings`.
// specs/rbac/grants-rest-api.feature
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import { ledgerActorSchema } from "@langwatch/authorization";
import {
  AuthzApi,
  authzPrincipalRefSchema,
  grantCreateSchema,
  grantListQuerySchema,
  grantPageSchema,
  grantParamsSchema,
  grantRevokedSchema,
  grantSchema,
  grantUpdateSchema,
} from "@langwatch/authz-contract";
import { z } from "zod";

/** The organization credential: the tenant, the ledger actor, whose permissions bound a grant. */
export const grantRestFacts = defineRestMiddleware(
  "grantRestFacts",
  z.object({
    organizationId: z.string(),
    actor: ledgerActorSchema,
    caller: authzPrincipalRefSchema,
  }),
);

const TAGS = ["Grants"];
const CEILING =
  "A grant never confers a permission the caller does not hold at that scope: 403 grant_exceeds_caller_permissions names the missing permissions.";

export const authzGrantRest: Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<AuthzApi>;
}> = defineRestRouter(AuthzApi)
  .withNamespace("grants")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("organization")

  .get("/", "listGrants")
  .withQuery(grantListQuerySchema)
  .withPermission("organization:manage")
  .withEntitlement("enterprise", { feature: "MANAGEMENT_API" })
  .withOutput(grantPageSchema)
  .withDocs({
    tags: TAGS,
    summary: "List grants",
    description:
      "List the organization's grants, oldest first unless `order=newest`, each naming its principal (user, group or API key), role and scope. Filter by principal, role, scope or status; `status` is derived from `expiresAt`. Pages by cursor: pass `nextCursor` back as `cursor` until it is null.",
  })
  .withMiddleware(grantRestFacts)
  .handle(async ({ app, input }, facts) =>
    app.listGrants({ organizationId: facts.organizationId, query: input }),
  )

  .post("/", "createGrant")
  .withInput(grantCreateSchema)
  .withPermission("organization:manage")
  .withEntitlement("enterprise", { feature: "MANAGEMENT_API" })
  .withOutput(grantSchema)
  .withStatus(201)
  .withIdempotency({ operation: "grants.v1.create" })
  .withDocs({
    tags: TAGS,
    summary: "Grant a role",
    description: `Grant a role to a user, group or API key on the organization, a team or a project. \`roleId\` is \`admin\`, \`member\`, \`viewer\` or a custom role's id. Grants are never unique: each create is a new grant with its own id, up to the organization's limit (409 grant_limit_reached). Pass \`expiresAt\` to time-box the access. Send \`Idempotency-Key\` to make a retry safe. ${CEILING}`,
  })
  .withMiddleware(grantRestFacts)
  .handle(async ({ app, input }, facts) =>
    app.createGrant({
      organizationId: facts.organizationId,
      grant: input,
      caller: facts.caller,
      actor: facts.actor,
    }),
  )

  .get("/:grantId", "getGrant")
  .withParams(grantParamsSchema)
  .withPermission("organization:manage")
  .withEntitlement("enterprise", { feature: "MANAGEMENT_API" })
  .withOutput(grantSchema)
  .withDocs({
    tags: TAGS,
    summary: "Get a grant",
    description:
      "Read one grant. An id outside the caller's organization answers 404 grant_not_found.",
  })
  .withMiddleware(grantRestFacts)
  .handle(async ({ app, input }, facts) =>
    app.getGrant({ organizationId: facts.organizationId, grantId: input.grantId }),
  )

  .patch("/:grantId", "updateGrant")
  .withParams(grantParamsSchema)
  .withInput(grantUpdateSchema)
  .withPermission("organization:manage")
  .withEntitlement("enterprise", { feature: "MANAGEMENT_API" })
  .withOutput(grantSchema)
  .withDocs({
    tags: TAGS,
    summary: "Change a grant's role",
    description: `Change the role a grant confers. The principal and scope are the grant's identity and do not change. Lowering the organization's last administrator answers cannot_demote_last_admin. ${CEILING}`,
  })
  .withMiddleware(grantRestFacts)
  .handle(async ({ app, input }, facts) =>
    app.changeGrantRole({
      organizationId: facts.organizationId,
      grantId: input.grantId,
      roleId: input.roleId,
      caller: facts.caller,
      actor: facts.actor,
    }),
  )

  .delete("/:grantId", "revokeGrant")
  .withParams(grantParamsSchema)
  .withPermission("organization:manage")
  .withEntitlement("enterprise", { feature: "MANAGEMENT_API" })
  .withOutput(grantRevokedSchema)
  .withDocs({
    tags: TAGS,
    summary: "Revoke a grant",
    description:
      "Revoke a grant. Identical grants each hold until revoked, so the access lasts until the last of them ends. Revoking the organization's last administrator answers cannot_remove_last_admin.",
  })
  .withMiddleware(grantRestFacts)
  .handle(async ({ app, input }, facts) =>
    app.revokeGrant({
      organizationId: facts.organizationId,
      grantId: input.grantId,
      actor: facts.actor,
    }),
  )
  .build();
