// Role-bindings REST family; custom role scope validation; actor bound not claimed.
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
  roleBindingRestCreateSchema,
  roleBindingRestDeletedSchema,
  roleBindingRestListQuerySchema,
  roleBindingRestListSchema,
  roleBindingRestParamsSchema,
  roleBindingRestSchema,
  roleBindingRestUpdateSchema,
  type AuthzManagedOrganizationBinding,
  type RoleBindingRest,
  type RoleBindingRestListQuery,
} from "@langwatch/authz-contract";
import { nowInstant } from "@langwatch/time";
import { z } from "zod";

import { bindingWire, optimisticBindingWire } from "../rules/role-binding-read-back.rules.ts";

/** What the organization credential resolved, as this family reads it. */
export const roleBindingRestFacts = defineRestMiddleware(
  "roleBindingRestFacts",
  z.object({
    organizationId: z.string(),
    actor: ledgerActorSchema,
    caller: authzPrincipalRefSchema,
  }),
);

const matchesFilters = (
  row: AuthzManagedOrganizationBinding,
  query: RoleBindingRestListQuery,
): boolean =>
  (query.userId === undefined || row.userId === query.userId) &&
  (query.groupId === undefined || row.groupId === query.groupId) &&
  (query.apiKeyId === undefined || row.apiKeyId === query.apiKeyId) &&
  (query.scopeType === undefined || row.scopeType === query.scopeType) &&
  (query.scopeId === undefined || row.scopeId === query.scopeId);

/**
 * The just-written binding as the list reports it, so a write's response is
 * byte-compatible with a later read — none while the grants projection is
 * still behind the append that created it.
 */
const findWrittenBindings = async ({
  app,
  organizationId,
  bindingId,
}: {
  app: AuthzApi;
  organizationId: string;
  bindingId: string;
}): Promise<RoleBindingRest[]> => {
  const rows = await app.listManagedBindingsForOrganization({ organizationId });

  return rows.filter((candidate) => candidate.id === bindingId).map(bindingWire);
};

export const authzRoleBindingRest: Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<AuthzApi>;
}> = defineRestRouter(AuthzApi)
  .withNamespace("role-bindings")
  .withVersion(MANAGEMENT_API_VERSION)
  // The family reads the ORGANIZATION credential (roleBindingRestFacts calls
  // organizationCredentialOfRequest), so it must answer behind that door —
  // on the default project door the fact throws where the door should 401.
  .withCredential("organization")
  .withDeprecated({
    successor: "/api/grants",
    notice: "superseded by /api/grants, which answers the same rows as grants",
  })

  .get("/", "listRoleBindings")
  .withQuery(roleBindingRestListQuerySchema)
  .withPermission("organization:manage")
  .withEntitlement("enterprise", { feature: "MANAGEMENT_API" })
  .withOutput(roleBindingRestListSchema)
  .withDocs({
    tags: ["Role Bindings"],
    description:
      "List the organization's role bindings, each naming its principal (user, group or API key), role, scope, and the date its access ends if one was set. Filter by principal or scope; totalCount counts the filtered set.",
  })
  .withMiddleware(roleBindingRestFacts)
  .handle(async ({ app, input }, organization) => {
    const rows = await app.listManagedBindingsForOrganization({
      organizationId: organization.organizationId,
    });
    const filtered = rows.filter((row) => matchesFilters(row, input));
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 50;

    return {
      bindings: filtered.slice(offset, offset + limit).map(bindingWire),
      totalCount: filtered.length,
    };
  })

  .post("/", "createRoleBinding")
  .withInput(roleBindingRestCreateSchema)
  .withPermission("organization:manage")
  .withEntitlement("enterprise", { feature: "MANAGEMENT_API" })
  .withOutput(roleBindingRestSchema)
  .withStatus(201)
  .withDocs({
    tags: ["Role Bindings"],
    description:
      "Create a role binding for exactly one principal: a user, a group, or an API key. Every reference is checked against the caller's organization; an identical binding is written again, because bindings are never unique. Pass expiresAt to time-box the access: it stops granting at that moment on its own, without being revoked, and a date that has already passed answers 422 grant_expiry_in_past. The response always carries the new binding's id; the names of its principal, role and scope may be absent on this response alone, and a follow-up read carries them.",
  })
  .withMiddleware(roleBindingRestFacts)
  .handle(async ({ app, input }, organization) => {
    const organizationId = organization.organizationId;

    const created = await app.createBinding({
      organizationId,
      ...input,
      actor: organization.actor,
      caller: organization.caller,
    });

    // The write landed; the projection may not have. Answer with what was
    // written rather than failing a successful create over ordinary lag — the
    // id is what the caller needs, and a retry would append a second grant for
    // the same slot rather than being absorbed.
    const [readBack] = await findWrittenBindings({ app, organizationId, bindingId: created.id });
    const binding =
      readBack ??
      optimisticBindingWire({
        id: created.id,
        principal: { userId: input.userId, groupId: input.groupId, apiKeyId: input.apiKeyId },
        role: input.role,
        customRoleId: input.customRoleId,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        expiresAt: input.expiresAt,
        now: nowInstant,
      });

    return binding;
  })

  .patch("/:id", "updateRoleBinding")
  .withParams(roleBindingRestParamsSchema)
  .withInput(roleBindingRestUpdateSchema)
  .withPermission("organization:manage")
  .withEntitlement("enterprise", { feature: "MANAGEMENT_API" })
  .withOutput(roleBindingRestSchema)
  .withDocs({
    tags: ["Role Bindings"],
    description:
      "Change a binding's role (and custom role). The principal and scope are the binding's identity and do not change; create a new binding instead.",
  })
  .withMiddleware(roleBindingRestFacts)
  .handle(async ({ app, input }, organization) => {
    const organizationId = organization.organizationId;
    return app.updateRoleBinding({
      organizationId,
      bindingId: input.id,
      role: input.role,
      ...(input.customRoleId !== undefined ? { customRoleId: input.customRoleId } : {}),
      actor: organization.actor,
      caller: organization.caller,
    });
  })

  .delete("/:id", "deleteRoleBinding")
  .withParams(roleBindingRestParamsSchema)
  .withPermission("organization:manage")
  .withEntitlement("enterprise", { feature: "MANAGEMENT_API" })
  .withOutput(roleBindingRestDeletedSchema)
  .withDocs({
    tags: ["Role Bindings"],
    description:
      "Delete a role binding. An id that does not exist in the caller's organization answers 404 role_binding_not_found.",
  })
  .withMiddleware(roleBindingRestFacts)
  .handle(async ({ app, input }, organization) => {
    await app.deleteBinding({
      organizationId: organization.organizationId,
      bindingId: input.id,
      actor: organization.actor,
    });

    return { success: true as const };
  })
  .build();
