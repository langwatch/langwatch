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
import { createTrpcService, type TrpcPolicyDecorator } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  governanceWriteAcknowledgedSchema,
  ingestionTemplateSchema,
  type GovernanceApi,
} from "@langwatch/enterprise-governance-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";

export type IngestionTemplatesTrpcContext = Readonly<{
  app: Readonly<{ governance: GovernanceApi }>;
  actor(): Readonly<{ id: string }>;
}>;

type IngestionTemplatesTrpcProcedures<
  TContext extends IngestionTemplatesTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  policy(permission: AuthzPermission): TrpcPolicyDecorator;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
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
    const { protected: procedure, policy, validateOutput } = procedures;

    return createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .query("list", (p) =>
        p
          .withInput(organizationScope)
          .withOutput(ingestionTemplateSchema.array())
          .withPermission("aiTools:view")
          /**
           * User-facing catalog for /me Trace Ingest — platform defaults plus
           * any organization-authored templates visible to the caller's
           * organization. Disabled and archived rows are filtered out at the
           * service.
           */
          .handle(async ({ ctx, input }) =>
            ctx.app.governance.templateListForUser({ organizationId: input.organizationId }),
          ),
      )
      .query("adminList", (p) =>
        p
          .withInput(organizationScope)
          .withOutput(ingestionTemplateSchema.array())
          .withPermission("aiTools:manage")
          /**
           * Admin read-only catalog — the same union as `list`, read so the
           * admin transparency block can render the canonical OTTL. v1 is
           * read-only; admin OTTL authoring is deferred to v2.
           */
          .handle(async ({ ctx, input }) =>
            ctx.app.governance.templateListForOrgAdmin({ organizationId: input.organizationId }),
          ),
      )
      .query("get", (p) =>
        p
          .withInput(idAndOrg)
          .withOutput(ingestionTemplateSchema.nullable())
          .withPermission("aiTools:view")
          /**
           * One template by id, scoped to the caller's organization. A
           * cross-organization probe collapses to not-found, so this is no
           * enumeration vector. Backs the install drawer's metadata fetch.
           */
          .handle(async ({ ctx, input }) =>
            ctx.app.governance.templateGetByIdForOrg({
              id: input.id,
              organizationId: input.organizationId,
            }),
          ),
      )
      .mutation("create", (p) =>
        p
          .withInput(createSchema)
          .withOutput(ingestionTemplateSchema)
          .withPermission("aiTools:manage")
          /**
           * Admin authoring: creates an organization-authored template. The
           * slug is server-generated. Platform rows live with a null
           * organization and are never created through here.
           *
           * `otlp_token` normalises to `null` for the credential schema
           * because the token is bearer-only; the two are equivalent on the
           * service side, and one of them is what the row stores.
           */
          .handle(async ({ ctx, input }) =>
            ctx.app.governance.templateCreateOrg({
              organizationId: input.organizationId,
              callerUserId: ctx.actor().id,
              sourceType: input.sourceType,
              displayName: input.displayName,
              description: input.description ?? null,
              iconAsset: input.iconAsset ?? null,
              credentialSchema:
                input.credentialSchema === "otlp_token" ? null : (input.credentialSchema ?? null),
              ottlRules: input.ottlRules,
              surface: "trpc",
            }),
          ),
      )
      .mutation("updateOttlRules", (p) =>
        p
          .withInput(updateOttlRulesSchema)
          .withOutput(ingestionTemplateSchema)
          .withPermission("aiTools:manage")
          /**
           * Replaces `ottlRules` on an organization-authored template. A
           * platform row refuses. Audit-logged with the line counts before and
           * after, for the forensic trail.
           */
          .handle(async ({ ctx, input }) =>
            ctx.app.governance.templateUpdateOttlRules({
              organizationId: input.organizationId,
              callerUserId: ctx.actor().id,
              id: input.id,
              ottlRules: input.ottlRules,
              surface: "trpc",
            }),
          ),
      )
      .mutation("archive", (p) =>
        p
          .withInput(idAndOrg)
          .withOutput(governanceWriteAcknowledgedSchema)
          .withPermission("aiTools:manage")
          /** Soft-archives an organization-authored template. Platform rows refuse. */
          .handle(async ({ ctx, input }) => {
            await ctx.app.governance.templateArchiveOrg({
              organizationId: input.organizationId,
              callerUserId: ctx.actor().id,
              id: input.id,
              surface: "trpc",
            });
            return { ok: true as const };
          }),
      )
      .mutation("cloneFromPlatform", (p) =>
        p
          .withInput(cloneFromPlatformSchema)
          .withOutput(ingestionTemplateSchema)
          .withPermission("aiTools:manage")
          /**
           * Clones a platform-published template into the caller's
           * organization, so an admin can customise a platform default's OTTL
           * without touching the canonical row. The clone starts as an exact
           * copy and admin edits proceed through `updateOttlRules`.
           */
          .handle(async ({ ctx, input }) =>
            ctx.app.governance.templateCloneFromPlatform({
              organizationId: input.organizationId,
              callerUserId: ctx.actor().id,
              sourceTemplateId: input.sourceTemplateId,
              surface: "trpc",
            }),
          ),
      )
      .build();
  }
}
