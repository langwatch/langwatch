/**
 * The role-bindings management REST family.
 *
 * A binding grants one role to exactly one principal (a user, a group, or an
 * API key) at one scope. Every reference is validated against the caller's
 * organization before the write, an identical declaration answers a
 * deterministic 409 (`role_binding_already_exists`), and a custom role that
 * carries an organization-exclusive permission is refused at team or project
 * scope at write time rather than silently never granting (ADR-021).
 *
 * A create for a user whose access until now came only from legacy team
 * membership reports `hasLegacyAccessNotice: true`: their first explicit binding
 * switches the team-derived fallback off, which is worth telling the operator
 * even though the write itself is exactly what they asked for.
 *
 * Every write here is a grants-ledger command (ADR-092 §13), so the audit
 * trail is the pipeline's insert-only subscriber (decision 17): these
 * handlers never emit `management.roleBinding.*` rows of their own — that
 * would record the same mutation twice.
 */
import type { EndpointVariables, ServiceContext } from "@langwatch/api";
import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import type { Context } from "hono";
import { z } from "zod";
import { orgRequestLedgerActor } from "~/app/api/shared/ledger-actor";
import { appFromContext } from "~/app/api/middleware/app-context";
import { type Organization, RoleBindingScopeType, TeamUserRole } from "~/generated/prisma/client";
import { createManagementService } from "~/server/api/management/managed-service";
import { MANAGEMENT_API_VERSION } from "~/server/api/management/version";
import { optimisticBindingWire } from "./read-back";

const { service, guard } = createManagementService({
  name: "role-bindings",
  basePath: "/api/role-bindings",
  feature: "MANAGEMENT_API",
});

/** The handler context: the framework's variables plus the family's provider. */
type RoleBindingsContext = ServiceContext<
  EndpointVariables & { authz: AuthzService; grants: AuthzGrantsService }
>;

// ── wire schemas ─────────────────────────────────────────────────────────────

const principalSchema = z.object({
  type: z.enum(["user", "group", "apiKey"]),
  id: z.string(),
  name: z.string().nullable(),
});

const bindingSchema = z.object({
  id: z.string(),
  principal: principalSchema,
  role: z.nativeEnum(TeamUserRole),
  customRoleId: z.string().nullable(),
  customRoleName: z.string().nullable(),
  scopeType: z.nativeEnum(RoleBindingScopeType),
  scopeId: z.string(),
  scopeName: z.string().nullable(),
  createdAt: z.date(),
});

const createdBindingSchema = bindingSchema.extend({
  /**
   * Present (true) only when this is the user's first explicit binding and
   * their access so far derived from legacy team membership, which this
   * write switches off. Informative, never blocking.
   */
  hasLegacyAccessNotice: z.boolean().optional(),
});

const listQuerySchema = z.object({
  userId: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
  apiKeyId: z.string().min(1).optional(),
  scopeType: z.nativeEnum(RoleBindingScopeType).optional(),
  scopeId: z.string().min(1).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const createBindingSchema = z.object({
  /** Exactly one of userId, groupId or apiKeyId; the service enforces it. */
  userId: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
  apiKeyId: z.string().min(1).optional(),
  role: z.nativeEnum(TeamUserRole),
  customRoleId: z.string().min(1).optional(),
  scopeType: z.nativeEnum(RoleBindingScopeType),
  scopeId: z.string().min(1),
});

const updateBindingSchema = z.object({
  role: z.nativeEnum(TeamUserRole),
  customRoleId: z.string().min(1).optional(),
});

const idParamsSchema = z.object({ id: z.string().min(1) });

type OrgBindingRow = Awaited<
  ReturnType<AuthzService["listManagedBindingsForOrganization"]>
>[number];

const principalOf = (row: OrgBindingRow): z.infer<typeof principalSchema> => {
  if (row.userId) {
    return { type: "user", id: row.userId, name: row.userName ?? null };
  }
  if (row.groupId) {
    return { type: "group", id: row.groupId, name: row.groupName ?? null };
  }
  return {
    type: "apiKey",
    id: row.apiKeyId ?? "",
    name: row.apiKeyName ?? null,
  };
};

const bindingWire = (row: OrgBindingRow): z.infer<typeof bindingSchema> => ({
  id: row.id,
  principal: principalOf(row),
  role: row.role,
  customRoleId: row.customRoleId,
  customRoleName: row.customRoleName,
  scopeType: row.scopeType,
  scopeId: row.scopeId,
  scopeName: row.scopeName,
  createdAt: row.createdAt,
});

const rowMatchesFilters = (row: OrgBindingRow, query: z.infer<typeof listQuerySchema>): boolean =>
  (query.userId === undefined || row.userId === query.userId) &&
  (query.groupId === undefined || row.groupId === query.groupId) &&
  (query.apiKeyId === undefined || row.apiKeyId === query.apiKeyId) &&
  (query.scopeType === undefined || row.scopeType === query.scopeType) &&
  (query.scopeId === undefined || row.scopeId === query.scopeId);

const organizationOf = (c: Context): Organization => c.get("organization") as Organization;

/**
 * The just-written binding as the list reports it, so a write's response is
 * byte-compatible with a later read — or null while the grants projection is
 * still behind the append that created it.
 *
 * Null is not an error here. `attachBindings` waits for the projection, but
 * that wait is bounded and timeout-tolerant, so a miss means "durable, not
 * yet projected". What each caller does with the miss differs, and is stated
 * at the call site.
 */
const readBackBinding = async ({
  authz,
  organizationId,
  bindingId,
}: {
  authz: AuthzService;
  organizationId: string;
  bindingId: string;
}): Promise<z.infer<typeof bindingSchema> | null> => {
  const rows = await authz.listManagedBindingsForOrganization({ organizationId });
  const row = rows.find((candidate) => candidate.id === bindingId);
  return row ? bindingWire(row) : null;
};

// ── handlers ─────────────────────────────────────────────────────────────────

const listBindingsHandler = async (
  c: RoleBindingsContext,
  input: z.infer<typeof listQuerySchema>,
) => {
  const rows = await c.get("authz").listManagedBindingsForOrganization({
    organizationId: organizationOf(c).id,
  });
  const filtered = rows.filter((row) => rowMatchesFilters(row, input));
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 50;
  return {
    bindings: filtered.slice(offset, offset + limit).map(bindingWire),
    totalCount: filtered.length,
  };
};

const createBindingHandler = async (
  c: RoleBindingsContext,
  input: z.infer<typeof createBindingSchema>,
) => {
  const organization = organizationOf(c);
  const authz = c.get("authz");
  const grants = c.get("grants");
  const hasLegacyAccessNotice = input.userId
    ? await authz.wouldFirstBindingDisableLegacyAccess({
        organizationId: organization.id,
        userId: input.userId,
      })
    : false;

  const created = await grants.createBinding({
    organizationId: organization.id,
    ...input,
    actor: orgRequestLedgerActor(c),
  });

  // The write landed; the projection may not have. Answer with what was
  // written rather than failing a successful create over ordinary lag — the
  // id is what the caller needs, and a retry would append a second grant for
  // the same slot rather than being absorbed (it only answers 409
  // role_binding_already_exists once the first row is projected).
  const binding =
    (await readBackBinding({
      authz,
      organizationId: organization.id,
      bindingId: created.id,
    })) ??
    optimisticBindingWire({
      id: created.id,
      principal: {
        userId: input.userId,
        groupId: input.groupId,
        apiKeyId: input.apiKeyId,
      },
      role: input.role,
      customRoleId: input.customRoleId,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
    });
  return {
    ...binding,
    ...(hasLegacyAccessNotice ? { hasLegacyAccessNotice: true } : {}),
  };
};

const updateBindingHandler = async (
  c: RoleBindingsContext,
  input: z.infer<typeof idParamsSchema> & z.infer<typeof updateBindingSchema>,
) => {
  const organization = organizationOf(c);
  const authz = c.get("authz");
  const updated = await c.get("grants").updateBinding({
    organizationId: organization.id,
    bindingId: input.id,
    role: input.role,
    ...(input.customRoleId !== undefined ? { customRoleId: input.customRoleId } : {}),
    actor: orgRequestLedgerActor(c),
  });
  const binding = await readBackBinding({
    authz,
    organizationId: organization.id,
    bindingId: updated.id,
  });
  // A patch, unlike a create, changed a row the service had already read from
  // the projection, so lag cannot explain its absence from the listing: only
  // an unexpected state can (the principal leaving the organization while the
  // request was in flight, say). Nothing the caller can act on, so it stays a
  // plain Error and degrades to the generic failure plus a trace id (ADR-045)
  // rather than pretending to be a nameable refusal.
  if (!binding) {
    throw new Error(`Role binding ${updated.id} was written but does not read back`);
  }
  return binding;
};

const deleteBindingHandler = async (
  c: RoleBindingsContext,
  input: z.infer<typeof idParamsSchema>,
) => {
  const organization = organizationOf(c);
  await c.get("grants").deleteBinding({
    organizationId: organization.id,
    bindingId: input.id,
    actor: orgRequestLedgerActor(c),
  });
  return { success: true as const };
};

// ── service wiring ───────────────────────────────────────────────────────────

export const app = service
  .provide({
    authz: (_base, context) => appFromContext(context).permissions,
    grants: (_base, context) => appFromContext(context).authzGrants,
  })
  .registerRoute("get", "/", MANAGEMENT_API_VERSION, listBindingsHandler, (b) =>
    guard("organization:manage")(b)
      .withQuery(listQuerySchema)
      .withOutput(
        z.object({
          bindings: z.array(bindingSchema),
          totalCount: z.number(),
        }),
      )
      .withDocs({
        operationId: "listRoleBindings",
        tags: ["Role Bindings"],
        description:
          "List the organization's role bindings, each naming its principal (user, group or API key), role and scope. Filter by principal or scope; totalCount counts the filtered set.",
      }),
  )
  .registerRoute("post", "/", MANAGEMENT_API_VERSION, createBindingHandler, (b) =>
    guard("organization:manage")(b)
      .withInput(createBindingSchema)
      .withOutput(createdBindingSchema)
      .withStatus(201)
      .withDocs({
        operationId: "createRoleBinding",
        tags: ["Role Bindings"],
        description:
          "Create a role binding for exactly one principal: a user, a group, or an API key. Every reference is checked against the caller's organization, and an identical binding answers 409 role_binding_already_exists. The response always carries the new binding's id; the names of its principal, role and scope may be absent on this response alone, and a follow-up read carries them.",
      }),
  )
  .registerRoute("patch", "/:id", MANAGEMENT_API_VERSION, updateBindingHandler, (b) =>
    guard("organization:manage")(b)
      .withParams(idParamsSchema)
      .withInput(updateBindingSchema)
      .withOutput(bindingSchema)
      .withDocs({
        operationId: "updateRoleBinding",
        tags: ["Role Bindings"],
        description:
          "Change a binding's role (and custom role). The principal and scope are the binding's identity and do not change; create a new binding instead.",
      }),
  )
  .registerRoute("delete", "/:id", MANAGEMENT_API_VERSION, deleteBindingHandler, (b) =>
    guard("organization:manage")(b)
      .withParams(idParamsSchema)
      .withOutput(z.object({ success: z.literal(true) }))
      .withDocs({
        operationId: "deleteRoleBinding",
        tags: ["Role Bindings"],
        description:
          "Delete a role binding. An id that does not exist in the caller's organization answers 404 role_binding_not_found.",
      }),
  )
  .build();
