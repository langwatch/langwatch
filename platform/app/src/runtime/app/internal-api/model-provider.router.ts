import {
  type AuthzPermission,
  authzDeclarationOf,
  declareAuthzMiddleware,
  type EnforcedScopeFields,
} from "@langwatch/authz-contract";
import type { LegacyAuditLogInput } from "@langwatch/enterprise-audit-log-server";
import { LlmModelCostTrpcApi, ModelProviderTrpcApi } from "@langwatch/model-provider-server";
import { TRPCError } from "@trpc/server";
import { auditLog } from "~/runtime/app/features/audit-log";
import {
  authorizeInResolver,
  checkOrganizationPermission,
  checkProjectPermission,
} from "~/server/api/rbac";
import { appTrpcRoot } from "~/server/api/trpc.root";
import {
  auditLogMutations,
  authProtectedProcedure,
  enforcePermissionCheck,
  handledErrorMiddleware,
  loggerMiddleware,
  tracerMiddleware,
} from "~/server/api/trpc.runtime-policy";
import { scopeLineageGuard } from "~/server/api/trpc.scope-lineage-middleware";
import {
  checkDeclaredPermission,
  declaredServiceAuthorization,
} from "~/server/app-layer/authz/trpc-middleware";
import {
  type CostRulePreviewInput,
  previewCostRuleMatchingSpans,
} from "~/server/app-layer/traces/model-cost-span-preview.service";
import type { SpanStorageService } from "~/server/app-layer/traces/span-storage.service";
import { CodexAccountService } from "~/server/modelProviders/codexAccount.service";
import { assertCanManageAllScopes } from "~/server/modelProviders/modelProvider.authz";
import {
  validateKeyWithCustomUrl,
  validateProviderApiKey,
} from "~/server/modelProviders/providerValidation";
import type { ScopeAssignment } from "~/server/scopes/scope.types";
import { getModelLimits } from "~/utils/modelLimits";
import { isSafeRegex } from "~/utils/safeRegex";

/**
 * The `.use()` surface every tRPC procedure builder shares. Named at the one
 * seam that applies process middlewares to a builder whose input generics
 * belong to the feature package, so the policies below need no `any`.
 */
type ChainableProcedure = { use(middleware: unknown): ChainableProcedure };

/**
 * A middleware carrying the authz declaration the router sweep reads. Written
 * as the widest shape every declared check satisfies, so one chain below
 * serves all four declaration kinds.
 */
type DeclaredCheck = (params: never) => Promise<unknown>;

/**
 * Exactly the chain `protectedProcedure.input(…).permission(…)` and
 * `.input(…).use(declaredMiddleware)` build, handed to the feature so it
 * applies the policy AFTER its own input parser: tRPC runs middlewares in the
 * order they were added, and every check below reads its scope id from the
 * validated input. One chain for all four declaration kinds, so they cannot
 * drift in what wraps them.
 */
const withCheck =
  (check: DeclaredCheck) =>
  <TProcedure>(procedure: TProcedure): TProcedure =>
    (procedure as unknown as ChainableProcedure)
      .use(tracerMiddleware)
      .use(loggerMiddleware)
      .use(handledErrorMiddleware)
      // Ahead of the check on purpose: a request mixing scope ids across
      // organizations is refused before ANY declaration kind — declared,
      // custom, or service-authorized — can pass on one id while the handler
      // acts on another.
      .use(scopeLineageGuard(authzDeclarationOf(check)))
      .use(check)
      .use(enforcePermissionCheck)
      // Keeps the credential redaction in force for `modelProvider.update`:
      // `customKeys`, `providerConfig` and `extraHeaders` keep their field
      // names in the audit record and lose their values.
      .use(auditLogMutations) as unknown as TProcedure;

/**
 * Tenant gate for a provider write that may arrive with either handle. A
 * provider belongs to an organization and reaches the scopes attached to
 * it, so a project is one valid way to name the tenant and the
 * organization is the other — an organization on the agent-governance
 * track has no project until it needs one, and organization scope is the
 * default for a new credential.
 *
 * With a project, this is the unchanged project permission check. Without
 * one, it falls back to organization membership, which establishes the
 * caller belongs to the tenant they named and nothing more. What the
 * caller may actually write is decided per scope by
 * `assertCanManageAllScopes` in the service, which is where organization
 * scope demands `organization:manage`, team demands `team:manage`, and
 * project demands `project:manage`. Same division of labour as
 * the canonical service's authorization dependency.
 */
function checkProjectOrOrganizationPermission(
  projectPermission: "project:update" | "project:delete",
) {
  const projectCheck = checkProjectPermission(projectPermission);
  const organizationCheck = checkOrganizationPermission("organization:view");
  return declareAuthzMiddleware(
    {
      kind: "custom",
      reason:
        "the tenant anchor is data-dependent: a project when one is named, otherwise the organization",
      permissions: [projectPermission, "organization:view"],
    },
    async (params: {
      ctx: any;
      input: { projectId?: string; organizationId?: string };
      next: () => any;
    }) => {
      if (params.input.projectId) {
        return projectCheck({
          ...params,
          input: { ...params.input, projectId: params.input.projectId },
        });
      }
      if (!params.input.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Either a project or an organization is required.",
        });
      }
      return organizationCheck({
        ...params,
        input: { ...params.input, organizationId: params.input.organizationId },
      });
    },
  );
}

/**
 * Tenant gate for the credential probe.
 *
 * Nothing downstream re-authorizes this one. The handler goes straight out
 * to the provider with caller-supplied keys and, for the `custom` provider,
 * a caller-supplied base URL, so whatever gate sits here IS the
 * authorization rather than a coarse pre-filter. Organization membership
 * would not do: `organization:view` is held by MEMBER and EXTERNAL, which
 * would turn a read-only seat into an arbitrary outbound request from our
 * servers.
 *
 * With a project this stays the pre-existing `project:update` check.
 * Without one it runs the same per-scope check the provider writes use, so
 * "may I probe a credential for this scope" is the same question, answered
 * by the same code, as "may I store a credential at this scope".
 */
function checkProviderValidationPermission() {
  const projectCheck = checkProjectPermission("project:update");
  return declareAuthzMiddleware(
    {
      kind: "custom",
      reason:
        "the credential probe authorizes against the scopes it is being set up for when no project is named",
      // Both paths the body can take: project:update when a project is named,
      // and the per-scope manage permissions assertCanManageAllScopes probes
      // when it is not (canManageScope in modelProvider.authz.ts).
      permissions: ["project:update", "project:manage", "team:manage", "organization:manage"],
    },
    async (params: {
      ctx: any;
      input: {
        projectId?: string;
        organizationId?: string;
        scopes?: ScopeAssignment[];
      };
      next: () => any;
    }) => {
      if (params.input.projectId) {
        return projectCheck({
          ...params,
          input: { ...params.input, projectId: params.input.projectId },
        });
      }
      const scopes = params.input.scopes;
      if (!scopes || scopes.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Validating a credential without a project needs the scopes it is being set up for.",
        });
      }
      await assertCanManageAllScopes(
        { prisma: params.ctx.prisma, session: params.ctx.session },
        scopes,
      );
      params.ctx.permissionChecked = true;
      return params.next();
    },
  );
}

/** Process transport mount for mixed tRPC batches; feature behaviour is package-owned. */
export const modelProviderRouter = ModelProviderTrpcApi.create(
  appTrpcRoot,
  {
    protected: authProtectedProcedure,
    policy: (permission: AuthzPermission) => withCheck(checkDeclaredPermission({ permission })),
    tenantWritePolicy: (permission: "project:update" | "project:delete") =>
      withCheck(checkProjectOrOrganizationPermission(permission)),
    credentialProbePolicy: withCheck(checkProviderValidationPermission()),
    serviceAuthorizedPolicy: (options: {
      reason: string;
      permissions: readonly AuthzPermission[];
    }) => withCheck(declaredServiceAuthorization(options)),
  },
  {
    validateProviderApiKey,
    validateKeyWithCustomUrl,
    startCodexDeviceSignIn: () => new CodexAccountService().startDeviceSignIn(),
    pollCodexDeviceSignIn: (input: { deviceAuthId: string; userCode: string }) =>
      new CodexAccountService().pollDeviceSignIn(input),
    // Fire and forget, as the router has always done: a connect is recorded,
    // but a slow audit write never holds up the sign-in response.
    recordAudit: (entry: LegacyAuditLogInput) => {
      void auditLog(entry);
    },
  },
);

/**
 * Custom LLM model costs, the second transport this feature owns. Mounted
 * beside the provider surface rather than in a file of its own because both
 * carry the same process policy chain and the same feature's services; the
 * router key stays `llmModelCost` so no action path moves.
 */
export const llmModelCostsRouter = LlmModelCostTrpcApi.create(
  appTrpcRoot,
  {
    protected: authProtectedProcedure,
    policy: (permission: AuthzPermission) => withCheck(checkDeclaredPermission({ permission })),
    resolverAuthorizedPolicy: (enforces: EnforcedScopeFields) =>
      withCheck(authorizeInResolver(enforces)),
  },
  {
    isSafeRegex,
    getModelLimits,
    // The package carries the request's span reader through untouched; only
    // this process knows its concrete type, so the narrowing happens here.
    previewMatchingSpans: ({ spans, input }: { spans: unknown; input: CostRulePreviewInput }) =>
      previewCostRuleMatchingSpans({ spans: spans as SpanStorageService, input }),
  },
);
