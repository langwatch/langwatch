/**
 * Personal and service API credentials over the process's tRPC transport.
 *
 *   myBindings:   the caller's own role bindings in one organization, which
 *                 the create/edit drawers mirror so a key can never be given
 *                 more than its creator holds.
 *   nameById:     one key id resolved to a display name. Deliberately narrower
 *                 than `list` — see the note on the procedure.
 *   list:         the organization's keys for an admin, the caller's own for
 *                 everyone else.
 *   create:       mints a key. The ONLY procedure that ever returns the
 *                 plaintext token, and it returns it once, at the moment of
 *                 minting. Every read below hands back a five-character
 *                 `lookupIdPrefix` and nothing more.
 *   update:       name, description, permission mode, permissions, bindings.
 *   revoke:       retires a key.
 *   orgProjects / orgTeams / orgMembers: the pickers the drawers render.
 *
 * Authorization is deliberately not declared as a permission: a personal API
 * key is the caller's own, and no `apiKey:*` permission exists to check. The
 * handler proves organization membership through
 * `ApiKeyService.ensureCallerIsOrgMember` before it reads anything, and the
 * admin-only paths (service keys, keys assigned to another user, another
 * user's key) ask `isOrgAdmin`. That is why every procedure below declares
 * `noPermission` with the organization id explicitly allowed.
 *
 * Transport only: input validation, the membership and admin gates, audit,
 * and delegation to `ApiKeyService`.
 */
import {
  API_KEY_PERMISSION_MODES,
  apiKeyPermissionFormatSchema as permissionFormatSchema,
  apiKeyRoleSchema,
  apiKeyScopeTypeSchema,
  refineRestrictedPermissions,
  type ApiKeyBinding,
  type ApiKeyService,
} from "@langwatch/api-key-contract";
import { HandledError } from "@langwatch/handled-error";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";

type ApiKeyApplication = Readonly<{ apiKeys: ApiKeyService }>;

/** The process supplies authentication; authorization arrives as `noPermission`. */
export type ApiKeyTrpcContext = Readonly<{
  app: ApiKeyApplication;
  actor(): Readonly<{ id: string }>;
}>;

/**
 * The declaration every procedure here carries: authenticated, deliberately
 * unchecked, with each scope id the input accepts allowed by name and reason.
 */
type NoPermissionOptions = Readonly<{
  reason: string;
  allow: Readonly<Record<string, string>>;
}>;

type ApiKeyTrpcProcedures<
  TContext extends ApiKeyTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, audit and
   * opted-out-authorization policy for one written reason.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the scope-lineage guard and the audit row both read
   * the validated input: tRPC runs middlewares in the order they were added,
   * so anything installed before `.input()` would see no input at all.
   */
  noPermission(options: NoPermissionOptions): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

/** The process capabilities this transport needs that are not the key's own. */
type ApiKeyTrpcPorts = Readonly<{
  /**
   * The process's audit trail. Fire-and-forget, as this router has always
   * recorded it: a slow audit write never holds up a credential response.
   */
  recordAudit(
    entry: Readonly<{
      userId: string;
      organizationId: string;
      action: string;
      args: Readonly<Record<string, unknown>>;
    }>,
  ): void;
}>;

/**
 * One shared reason: nothing here is gated on a permission, because a personal
 * key belongs to its owner and the handler proves that itself.
 */
const OWN_KEYS_REASON =
  "personal API keys are the caller's own; the handler proves organization membership and ownership itself";

/**
 * Translates the service's handled failures into their transport codes.
 *
 * Only the causes the service names are mapped. Anything else — an
 * infrastructure failure above all — is rethrown untouched so it degrades to a
 * generic unknown carrying a trace id, per ADR-045. Nothing here invents a
 * `HandledError` for a cause we cannot name.
 */
function mapApiKeyHandledError(error: unknown): never {
  if (HandledError.isHandled(error)) {
    switch (error.code) {
      case "api_key_not_found":
        throw new TRPCError({
          code: "NOT_FOUND",
          message: error.message,
          cause: error,
        });
      case "api_key_not_owned":
      case "api_key_permission_denied":
      case "api_key_scope_violation":
        throw new TRPCError({
          code: "FORBIDDEN",
          message: error.message,
          cause: error,
        });
      case "api_key_already_revoked":
        throw new TRPCError({
          code: "CONFLICT",
          message: error.message,
          cause: error,
        });
      case "api_key_reserved_name":
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error.message,
          cause: error,
        });
      default:
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
          cause: error,
        });
    }
  }
  throw error;
}

async function ensureCallerIsOrgMember(
  service: ApiKeyService,
  userId: string,
  organizationId: string,
): Promise<void> {
  try {
    await service.ensureCallerIsOrgMember({ userId, organizationId });
  } catch (error) {
    mapApiKeyHandledError(error);
  }
}

/**
 * The binding shape the drawers post. Deliberately narrower than the
 * contract's `apiKeyScopeSchema`: it is not `.strict()`, so a stray field is
 * stripped rather than refused, and it carries no `customRoleId` — a
 * restricted key's custom role is minted by the service, never named by the
 * client.
 */
const roleBindingSchema = z.object({
  role: apiKeyRoleSchema,
  scopeType: apiKeyScopeTypeSchema,
  scopeId: z.string(),
});

const organizationScopeSchema = z.object({ organizationId: z.string() });

const nameByIdInputSchema = z.object({
  organizationId: z.string(),
  apiKeyId: z.string(),
});

const createInputSchema = z
  .object({
    organizationId: z.string(),
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    expiresAt: z.coerce.date().optional(),
    permissionMode: z.enum(API_KEY_PERMISSION_MODES).default("all"),
    keyType: z.enum(["personal", "service"]).default("personal"),
    assignedToUserId: z.string().optional(),
    permissions: z.array(permissionFormatSchema).optional(),
    bindings: z.array(roleBindingSchema).max(20),
  })
  .superRefine(refineRestrictedPermissions);

const updateInputSchema = z
  .object({
    organizationId: z.string(),
    apiKeyId: z.string(),
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).nullish(),
    permissionMode: z.enum(API_KEY_PERMISSION_MODES).optional(),
    permissions: z.array(permissionFormatSchema).optional(),
    bindings: z.array(roleBindingSchema).min(1).max(20).optional(),
  })
  .superRefine(refineRestrictedPermissions);

const revokeInputSchema = z.object({
  organizationId: z.string(),
  apiKeyId: z.string(),
});

/**
 * Installs the complete `apiKey.*` tRPC surface on a process-owned root. The
 * procedure and the declaration policy are injected by the process so its
 * auth, audit, error, logging and tracing policies wrap every feature
 * procedure consistently.
 */
export class ApiKeyTrpcApi {
  static create<
    TContext extends ApiKeyTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: ApiKeyTrpcProcedures<TContext, TOptions, TRoot>,
    ports: ApiKeyTrpcPorts,
  ) {
    const { protected: procedure, noPermission } = procedures;

    return trpc.router({
      /**
       * Returns the caller's own RoleBindings within the given organization.
       * Used by the Create/Edit drawers to mirror the user's permissions.
       */
      myBindings: noPermission({
        reason: OWN_KEYS_REASON,
        allow: { organizationId: "listing caller's own role bindings" },
      })(procedure.input(organizationScopeSchema)).query(async ({ ctx, input }) => {
        const apiKeyService = ctx.app.apiKeys;
        const actor = ctx.actor();
        await ensureCallerIsOrgMember(apiKeyService, actor.id, input.organizationId);
        const bindings = await apiKeyService.getUserBindings({
          userId: actor.id,
          organizationId: input.organizationId,
        });

        const { orgName, teamName, activeProjectIds, projectName, customRoleName } =
          await apiKeyService.enrichBindingsWithNames({ bindings });

        return bindings
          .filter((b) => b.scopeType !== "PROJECT" || activeProjectIds.has(b.scopeId))
          .map((b) => ({
            ...b,
            scopeName:
              b.scopeType === "ORGANIZATION"
                ? (orgName.get(b.scopeId) ?? null)
                : b.scopeType === "TEAM"
                  ? (teamName.get(b.scopeId) ?? null)
                  : (projectName.get(b.scopeId) ?? null),
            customRoleName: b.customRoleId ? (customRoleName.get(b.customRoleId) ?? null) : null,
          }));
      }),

      /**
       * Resolve a single API key id to its display name.
       *
       * Deliberately narrower than {@link list}, which is admin-gated for the
       * full org and would otherwise show most of the team a raw row id
       * wherever a key is referenced. This answers one question, for one id the
       * caller already has, and returns nothing else: no lookup id, no secret,
       * no owner, no bindings, no list. Any member of the organization may ask,
       * because anyone who can already read a trace can already see the id
       * stamped on it, and a name is less revealing than the id.
       *
       * Not an enumeration surface: it takes a whole id rather than a prefix or
       * a filter, answers one at a time, and returns null identically for an id
       * that does not exist and one that belongs to another organization.
       */
      nameById: noPermission({
        reason: OWN_KEYS_REASON,
        allow: { organizationId: "naming an API key the caller can already see" },
      })(procedure.input(nameByIdInputSchema)).query(async ({ ctx, input }) => {
        const apiKeyService = ctx.app.apiKeys;
        const actor = ctx.actor();
        await ensureCallerIsOrgMember(apiKeyService, actor.id, input.organizationId);
        return apiKeyService.tryGetNameByIdInOrg({
          id: input.apiKeyId,
          organizationId: input.organizationId,
        });
      }),

      /**
       * Lists API keys. Admins see all keys in the org; non-admins see only
       * their own. Never the secret — a key is identified here by the first
       * five characters of its lookup id.
       */
      list: noPermission({
        reason: OWN_KEYS_REASON,
        allow: { organizationId: "listing API keys" },
      })(procedure.input(organizationScopeSchema)).query(async ({ ctx, input }) => {
        const apiKeyService = ctx.app.apiKeys;
        const actor = ctx.actor();
        await ensureCallerIsOrgMember(apiKeyService, actor.id, input.organizationId);
        const callerIsAdmin = await apiKeyService.isOrgAdmin({
          userId: actor.id,
          organizationId: input.organizationId,
        });

        const apiKeys = callerIsAdmin
          ? await apiKeyService.listAll({ organizationId: input.organizationId })
          : await apiKeyService.list({
              userId: actor.id,
              organizationId: input.organizationId,
            });

        const allBindings = apiKeys.flatMap((k) => k.roleBindings);
        const { orgName, teamName, projectName, customRoleName, customRoles } =
          await apiKeyService.enrichBindingsWithNames({
            bindings: allBindings.map((rb): ApiKeyBinding => ({
              id: rb.id,
              role: rb.role,
              customRoleId: rb.customRoleId ?? null,
              scopeType: rb.scopeType,
              scopeId: rb.scopeId,
            })),
          });

        const customRolePermissions = new Map(
          customRoles.map((r) => [r.id, Array.isArray(r.permissions) ? r.permissions : []]),
        );

        const { users } = await apiKeyService.enrichApiKeyList({ apiKeys });
        const userName = new Map(users.map((u) => [u.id, u.name ?? u.email]));
        const userEmail = new Map(users.map((u) => [u.id, u.email]));

        return apiKeys.map((apiKey) => ({
          id: apiKey.id,
          lookupIdPrefix: apiKey.lookupId.slice(0, 5),
          name: apiKey.name,
          description: apiKey.description,
          permissionMode: apiKey.permissionMode,
          userId: apiKey.userId,
          userName: apiKey.userId ? (userName.get(apiKey.userId) ?? null) : null,
          userEmail: apiKey.userId ? (userEmail.get(apiKey.userId) ?? null) : null,
          createdByUserId: apiKey.createdByUserId,
          createdByUserName: apiKey.createdByUserId
            ? (userName.get(apiKey.createdByUserId) ?? null)
            : null,
          createdAt: apiKey.createdAt,
          expiresAt: apiKey.expiresAt,
          lastUsedAt: apiKey.lastUsedAt,
          revokedAt: apiKey.revokedAt,
          // Non-null marks this as an ingestion key (project-scoped, ingest-only
          // write credential the `langwatch <tool>` CLI mints). null = regular
          // personal / service key. Drives the API Keys page section split.
          ingestSourceType: apiKey.ingestSourceType,
          ingestionTemplateId: apiKey.ingestionTemplateId,
          // Human label of the CLI device session that minted this ingestion key
          // ("Rogerio's MacBook Pro"); null for keys without device provenance.
          createdByDeviceLabel: apiKey.createdByDeviceLabel,
          roleBindings: apiKey.roleBindings.map((rb) => ({
            id: rb.id,
            role: rb.role,
            customRoleId: rb.customRoleId ?? null,
            customRoleName: rb.customRoleId ? (customRoleName.get(rb.customRoleId) ?? null) : null,
            customRolePermissions: rb.customRoleId
              ? (customRolePermissions.get(rb.customRoleId) ?? null)
              : null,
            scopeType: rb.scopeType,
            scopeId: rb.scopeId,
          })),
        }));
      }),

      /**
       * Mints a key and hands back its plaintext token — once, here, and
       * nowhere else. Nothing stores it and no read returns it, so a caller who
       * loses it revokes and mints again.
       */
      create: noPermission({
        reason: OWN_KEYS_REASON,
        allow: { organizationId: "creating API key for user's own org" },
      })(procedure.input(createInputSchema)).mutation(async ({ ctx, input }) => {
        const apiKeyService = ctx.app.apiKeys;
        const actor = ctx.actor();
        await ensureCallerIsOrgMember(apiKeyService, actor.id, input.organizationId);
        const isService = input.keyType === "service";

        // Service keys and assigning to another user both require admin
        if (isService || (input.assignedToUserId && input.assignedToUserId !== actor.id)) {
          const callerIsAdmin = await apiKeyService.isOrgAdmin({
            userId: actor.id,
            organizationId: input.organizationId,
          });
          if (!callerIsAdmin) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: isService
                ? "Only organization admins can create service API keys"
                : "Only organization admins can create API keys for other users",
            });
          }
        }

        const targetUserId = isService ? null : (input.assignedToUserId ?? actor.id);
        const createdByUserId = actor.id;
        try {
          const { token, apiKey } = await apiKeyService.create({
            name: input.name,
            description: input.description,
            userId: targetUserId,
            createdByUserId,
            organizationId: input.organizationId,
            expiresAt: input.expiresAt,
            permissionMode: input.permissionMode,
            permissions: input.permissions,
            bindings: input.bindings,
          });

          // The token is deliberately absent from the audit arguments: only the
          // key's identity and shape are recorded, never its secret.
          ports.recordAudit({
            userId: actor.id,
            organizationId: input.organizationId,
            action: "apiKey.create",
            args: {
              apiKeyId: apiKey.id,
              name: input.name,
              keyType: input.keyType,
              permissionMode: input.permissionMode,
              assignedToUserId: targetUserId,
            },
          });

          return {
            token,
            apiKey: {
              id: apiKey.id,
              name: apiKey.name,
              createdAt: apiKey.createdAt,
            },
          };
        } catch (error) {
          mapApiKeyHandledError(error);
        }
      }),

      update: noPermission({
        reason: OWN_KEYS_REASON,
        allow: { organizationId: "updating API key" },
      })(procedure.input(updateInputSchema)).mutation(async ({ ctx, input }) => {
        const apiKeyService = ctx.app.apiKeys;
        const actor = ctx.actor();
        await ensureCallerIsOrgMember(apiKeyService, actor.id, input.organizationId);
        const callerIsAdmin = await apiKeyService.isOrgAdmin({
          userId: actor.id,
          organizationId: input.organizationId,
        });

        try {
          const updated = await apiKeyService.update({
            id: input.apiKeyId,
            callerUserId: actor.id,
            callerIsAdmin,
            organizationId: input.organizationId,
            name: input.name,
            description: input.description,
            permissionMode: input.permissionMode,
            permissions: input.permissions,
            bindings: input.bindings,
          });

          ports.recordAudit({
            userId: actor.id,
            organizationId: input.organizationId,
            action: "apiKey.update",
            args: {
              apiKeyId: input.apiKeyId,
              name: input.name,
              permissionMode: input.permissionMode,
            },
          });

          return {
            id: updated.id,
            name: updated.name,
            permissionMode: updated.permissionMode,
          };
        } catch (error) {
          mapApiKeyHandledError(error);
        }
      }),

      revoke: noPermission({
        reason: OWN_KEYS_REASON,
        allow: { organizationId: "revoking API key" },
      })(procedure.input(revokeInputSchema)).mutation(async ({ ctx, input }) => {
        const apiKeyService = ctx.app.apiKeys;
        const actor = ctx.actor();
        await ensureCallerIsOrgMember(apiKeyService, actor.id, input.organizationId);
        const callerIsAdmin = await apiKeyService.isOrgAdmin({
          userId: actor.id,
          organizationId: input.organizationId,
        });

        try {
          await apiKeyService.revoke({
            id: input.apiKeyId,
            callerUserId: actor.id,
            callerIsAdmin,
            organizationId: input.organizationId,
          });

          ports.recordAudit({
            userId: actor.id,
            organizationId: input.organizationId,
            action: "apiKey.revoke",
            args: { apiKeyId: input.apiKeyId },
          });
        } catch (error) {
          mapApiKeyHandledError(error);
        }
        return { success: true };
      }),

      /**
       * Returns all projects in the org for the restricted permissions picker.
       */
      orgProjects: noPermission({
        reason: OWN_KEYS_REASON,
        allow: { organizationId: "listing org projects for permission picker" },
      })(procedure.input(organizationScopeSchema)).query(async ({ ctx, input }) => {
        const apiKeyService = ctx.app.apiKeys;
        const actor = ctx.actor();
        await ensureCallerIsOrgMember(apiKeyService, actor.id, input.organizationId);
        return apiKeyService.getOrgProjects({
          organizationId: input.organizationId,
        });
      }),

      orgTeams: noPermission({
        reason: OWN_KEYS_REASON,
        allow: { organizationId: "listing org teams for scope picker" },
      })(procedure.input(organizationScopeSchema)).query(async ({ ctx, input }) => {
        const apiKeyService = ctx.app.apiKeys;
        const actor = ctx.actor();
        await ensureCallerIsOrgMember(apiKeyService, actor.id, input.organizationId);
        return apiKeyService.getOrgTeams({
          organizationId: input.organizationId,
        });
      }),

      orgMembers: noPermission({
        reason: OWN_KEYS_REASON,
        allow: { organizationId: "listing org members for key assignment" },
      })(procedure.input(organizationScopeSchema)).query(async ({ ctx, input }) => {
        const apiKeyService = ctx.app.apiKeys;
        const actor = ctx.actor();
        await ensureCallerIsOrgMember(apiKeyService, actor.id, input.organizationId);
        const callerIsAdmin = await apiKeyService.isOrgAdmin({
          userId: actor.id,
          organizationId: input.organizationId,
        });
        if (!callerIsAdmin) return [];

        return apiKeyService.getOrgMembers({
          organizationId: input.organizationId,
        });
      }),
    });
  }
}
