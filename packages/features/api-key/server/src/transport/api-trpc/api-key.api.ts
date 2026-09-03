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
 * key is the caller's own, and no `apiKey:*` permission exists to check.
 * {@link ApiKeyApp} proves organization membership before it reads anything,
 * and asks `isOrgAdmin` on the admin-only paths. That is why every procedure
 * below declares `noPermission` with the organization id explicitly allowed.
 *
 * Transport only: input validation, audit, and delegation to
 * {@link ApiKeyApp}. Nothing here constructs a transport error and nothing
 * here catches one: the feature's refusals are handled errors carrying their
 * own status, so the process's handled-error middleware derives the tRPC code
 * from the cause rather than from a translation table kept here.
 */
import {
  API_KEY_PERMISSION_MODES,
  apiKeyPermissionFormatSchema as permissionFormatSchema,
  apiKeyRoleSchema,
  apiKeyScopeTypeSchema,
  refineRestrictedPermissions,
} from "@langwatch/api-key-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import type { ApiKeyApp } from "#app/api-key.app";

/**
 * The process supplies authentication; authorization arrives as
 * `noPermission`.
 *
 * `app` is the slice of the process's application this feature reaches, not
 * the feature's application itself, because a tRPC root is shared by every
 * feature mounted on it and so carries all of them.
 */
export type ApiKeyTrpcContext = Readonly<{
  app: Readonly<{ apiKeys: ApiKeyApp }>;
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
 * key belongs to its owner and the application proves that itself.
 */
const OWN_KEYS_REASON =
  "personal API keys are the caller's own; the application proves organization membership and ownership itself";

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
      })(procedure.input(organizationScopeSchema)).query(async ({ ctx, input }) =>
        ctx.app.apiKeys.listCallerBindings(input, ctx.actor()),
      ),

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
      })(procedure.input(nameByIdInputSchema)).query(async ({ ctx, input }) =>
        ctx.app.apiKeys.getKeyName(input, ctx.actor()),
      ),

      /**
       * Lists API keys. Admins see all keys in the org; non-admins see only
       * their own. Never the secret — a key is identified here by the first
       * five characters of its lookup id.
       */
      list: noPermission({
        reason: OWN_KEYS_REASON,
        allow: { organizationId: "listing API keys" },
      })(procedure.input(organizationScopeSchema)).query(async ({ ctx, input }) =>
        ctx.app.apiKeys.listKeys(input, ctx.actor()),
      ),

      /**
       * Mints a key and hands back its plaintext token — once, here, and
       * nowhere else. Nothing stores it and no read returns it, so a caller who
       * loses it revokes and mints again.
       */
      create: noPermission({
        reason: OWN_KEYS_REASON,
        allow: { organizationId: "creating API key for user's own org" },
      })(procedure.input(createInputSchema)).mutation(async ({ ctx, input }) => {
        const actor = ctx.actor();
        const { token, apiKey, assignedToUserId } = await ctx.app.apiKeys.createKey(input, actor);

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
            assignedToUserId,
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
      }),

      update: noPermission({
        reason: OWN_KEYS_REASON,
        allow: { organizationId: "updating API key" },
      })(procedure.input(updateInputSchema)).mutation(async ({ ctx, input }) => {
        const actor = ctx.actor();
        const updated = await ctx.app.apiKeys.updateKey(input, actor);

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
      }),

      revoke: noPermission({
        reason: OWN_KEYS_REASON,
        allow: { organizationId: "revoking API key" },
      })(procedure.input(revokeInputSchema)).mutation(async ({ ctx, input }) => {
        const actor = ctx.actor();
        await ctx.app.apiKeys.revokeKey(input, actor);

        ports.recordAudit({
          userId: actor.id,
          organizationId: input.organizationId,
          action: "apiKey.revoke",
          args: { apiKeyId: input.apiKeyId },
        });

        return { success: true };
      }),

      /**
       * Returns all projects in the org for the restricted permissions picker.
       */
      orgProjects: noPermission({
        reason: OWN_KEYS_REASON,
        allow: { organizationId: "listing org projects for permission picker" },
      })(procedure.input(organizationScopeSchema)).query(async ({ ctx, input }) =>
        ctx.app.apiKeys.listOrganizationProjects(input, ctx.actor()),
      ),

      orgTeams: noPermission({
        reason: OWN_KEYS_REASON,
        allow: { organizationId: "listing org teams for scope picker" },
      })(procedure.input(organizationScopeSchema)).query(async ({ ctx, input }) =>
        ctx.app.apiKeys.listOrganizationTeams(input, ctx.actor()),
      ),

      orgMembers: noPermission({
        reason: OWN_KEYS_REASON,
        allow: { organizationId: "listing org members for key assignment" },
      })(procedure.input(organizationScopeSchema)).query(async ({ ctx, input }) =>
        ctx.app.apiKeys.listOrganizationMembers(input, ctx.actor()),
      ),
    });
  }
}
