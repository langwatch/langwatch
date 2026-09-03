/**
 * IngestionTemplate tRPC surface — the admin/platform-curated catalog.
 *
 * The admin surface for v1 lives as a second tab on the existing
 * `/governance/tool-catalog` page, so this router gates on `aiTools:*` rather
 * than a template-specific permission. User-facing reads use `aiTools:view`
 * (every org role); admin reads and writes use `aiTools:manage` (org ADMIN).
 *
 * Transport only: input parsing, delegation, wire shape. Every refusal
 * (`TemplateNotFoundError`, `PlatformTemplateImmutableError`,
 * `InvalidSourceTypeError`) is a `HandledError` on the service side, so the
 * error formatter serialises it without a bespoke translator here.
 *
 * Spec: specs/ai-gateway/governance/ingestion-templates-catalog.feature
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { GovernanceService } from "@langwatch/enterprise-governance-contract";
import type {
  AnyTRPCRootTypes,
  TRPCRootObject,
  TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";

export type IngestionTemplatesTrpcContext = Readonly<{
  app: Readonly<{ governance: GovernanceService }>;
  actor(): Readonly<{ id: string }>;
}>;

type ProcedureDecorator = <TProcedure>(procedure: TProcedure) => TProcedure;

type IngestionTemplatesTrpcProcedures<
  TContext extends IngestionTemplatesTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  policy(permission: AuthzPermission): ProcedureDecorator;
}>;

const organizationScope = z.object({ organizationId: z.string() });
const idAndOrg = organizationScope.extend({ id: z.string() });

const createSchema = organizationScope.extend({
  sourceType: z.string(),
  displayName: z.string().min(1).max(80),
  description: z.string().max(2000).optional(),
  iconAsset: z.string().max(20_000).optional(),
  credentialSchema: z.enum(["otlp_token", "static_api_key", "agent_id"]).nullable().optional(),
  ottlRules: z.string().max(50_000).optional(),
});

const updateOttlRulesSchema = idAndOrg.extend({
  ottlRules: z.string().max(50_000),
});

const cloneFromPlatformSchema = organizationScope.extend({
  sourceTemplateId: z.string(),
});

/** Installs the `ingestionTemplates.*` tRPC surface on a process root. */
export class IngestionTemplatesTrpcApi {
  static create<
    TContext extends IngestionTemplatesTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: IngestionTemplatesTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      /**
       * User-facing catalog for /me Trace Ingest — platform defaults + any
       * org-authored templates visible to the caller's org. Disabled or
       * archived rows are filtered out at the service; `ottlRules` is
       * omitted (internal implementation detail).
       */
      list: policy("aiTools:view")(procedure.input(organizationScope)).query(
        async ({ ctx, input }) =>
          ctx.app.governance.templateListForUser({
            organizationId: input.organizationId,
          }),
      ),

      /**
       * Admin readonly catalog — same union as `list` INCLUDING `ottlRules`
       * so the admin transparency block can render the canonical OTTL. v1 is
       * read-only; admin OTTL authoring is deferred to v2.
       */
      adminList: policy("aiTools:manage")(procedure.input(organizationScope)).query(
        async ({ ctx, input }) =>
          ctx.app.governance.templateListForOrgAdmin({
            organizationId: input.organizationId,
          }),
      ),

      /**
       * Single-template lookup by id, scoped to the caller's org. Cross-org
       * probes collapse to NOT_FOUND (no enumeration vector). Powers the
       * install drawer's metadata fetch when a user clicks a tile.
       */
      get: policy("aiTools:view")(procedure.input(idAndOrg)).query(
        async ({ ctx, input }) =>
          ctx.app.governance.templateGetByIdForOrg({
            id: input.id,
            organizationId: input.organizationId,
          }),
      ),

      /**
       * Admin authoring: create an org-authored template. Slug is server-
       * generated. Platform rows live with `organizationId IS NULL` and are
       * never created via this endpoint.
       *
       * `otlp_token` is normalised to `null` for the credential schema
       * because the token is bearer-only; the two values are equivalent on
       * the service side, and one is what the row stores.
       */
      create: policy("aiTools:manage")(procedure.input(createSchema)).mutation(
        async ({ ctx, input }) =>
          ctx.app.governance.templateCreateOrg({
            organizationId: input.organizationId,
            callerUserId: ctx.actor().id,
            sourceType: input.sourceType,
            displayName: input.displayName,
            description: input.description ?? null,
            iconAsset: input.iconAsset ?? null,
            credentialSchema:
              input.credentialSchema === "otlp_token"
                ? null
                : (input.credentialSchema ?? null),
            ottlRules: input.ottlRules,
            surface: "trpc",
          }),
      ),

      /**
       * Replace `ottlRules` on an org-authored template. Platform rows
       * refuse. Audit-logged with line counts pre/post for the forensic
       * trail.
       */
      updateOttlRules: policy("aiTools:manage")(
        procedure.input(updateOttlRulesSchema),
      ).mutation(async ({ ctx, input }) =>
        ctx.app.governance.templateUpdateOttlRules({
          organizationId: input.organizationId,
          callerUserId: ctx.actor().id,
          id: input.id,
          ottlRules: input.ottlRules,
          surface: "trpc",
        }),
      ),

      /** Soft-archive an org-authored template. Platform rows refuse. */
      archive: policy("aiTools:manage")(procedure.input(idAndOrg)).mutation(
        async ({ ctx, input }) => {
          await ctx.app.governance.templateArchiveOrg({
            organizationId: input.organizationId,
            callerUserId: ctx.actor().id,
            id: input.id,
            surface: "trpc",
          });
          return { ok: true as const };
        },
      ),

      /**
       * Clone a platform-published template into the caller's org. Admins
       * customise the OTTL of a platform default without touching the
       * canonical row; the clone starts as an exact copy and admin edits
       * proceed via `updateOttlRules`.
       */
      cloneFromPlatform: policy("aiTools:manage")(
        procedure.input(cloneFromPlatformSchema),
      ).mutation(async ({ ctx, input }) =>
        ctx.app.governance.templateCloneFromPlatform({
          organizationId: input.organizationId,
          callerUserId: ctx.actor().id,
          sourceTemplateId: input.sourceTemplateId,
          surface: "trpc",
        }),
      ),
    });
  }
}
