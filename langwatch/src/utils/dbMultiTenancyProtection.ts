import type { Prisma } from "@prisma/client";

const EXEMPT_MODELS = [
  "Account",
  "Session",
  "User",
  "VerificationToken",
  "TeamUser",
  "OrganizationUser",
  "Team",
  "Organization",
  "OrganizationInvite",
  "Project",
  "Subscription",
  "OrganizationFeature",
  "AuditLog",
  /**
   * Because prompts can be accessed at either the project or org level
   */
  "LlmPromptConfig",
  /**
   * Custom roles are organization-level, not project-level
   */
  "CustomRole",
  /**
   * Notifications can be at organization or project level
   */
  "Notification",
  /**
   * License enforcement needs to count resources across all projects in an organization.
   * These models are queried by organizationId (through project.team.organizationId)
   * for license limit enforcement.
   */
  "Workflow",
  "Evaluator",
  "Scenario",
  "BatchEvaluation",
  "Agent",
  /**
   * Billing meter checkpoints are organization-level, keyed by organizationId + billingMonth
   */
  "BillingMeterCheckpoint",
  /**
   * SCIM tokens are organization-level, used for IdP provisioning
   */
  "ScimToken",
  /**
   * Custom prompt tag definitions are organization-level, not project-level.
   * They are scoped by organizationId.
   */
  "PromptTag",
  /**
   * Scoped RBAC models are organization-level.
   * Groups and RoleBindings are scoped by organizationId, not projectId.
   * GroupMembership is scoped indirectly via groupId.
   */
  "Group",
  "GroupMembership",
  "RoleBinding",
  /**
   * PATs are organization-level, scoped by organizationId + userId.
   */
  "PersonalAccessToken",
  /**
   * AI Gateway models. Budgets are organization-level (scopeType +
   * scopeId identifies which target); ledger rows descend from VirtualKey
   * via virtualKeyId rather than a direct projectId column; change-events
   * and audit logs both allow null projectId for org-level mutations;
   * VirtualKeyProviderCredential is a join table whose composite PK is
   * (virtualKeyId, providerCredentialId) — projectId is reachable via
   * the parent VK but not a direct column. VirtualKey and
   * GatewayProviderCredential are project-scoped and stay under the
   * middleware's normal guard.
   */
  "GatewayBudget",
  "GatewayBudgetLedger",
  "GatewayChangeEvent",
  "GatewayAuditLog",
  "VirtualKeyProviderCredential",
  /**
   * GatewayCacheRule is organization-level (authored once, applies
   * across every VK owned by the org based on matcher shape). Same
   * rationale as GatewayBudget — no projectId column, scoped by
   * organizationId + matcher fields.
   */
  "GatewayCacheRule",
  /**
   * ModelProvider switched to principal-style scope (iter 107–108,
   * ADR-016): each row carries (scopeType, scopeId) mirroring
   * RoleBinding's tenancy. `findAllAccessibleForProject` walks the
   * scope ladder (PROJECT→TEAM→ORGANIZATION) with an OR across the
   * three scope buckets — the OR branches key off scopeId, not
   * projectId. The service layer re-enforces the tenancy boundary by
   * first looking up the project row (`project.findUnique`) to derive
   * the correct teamId + organizationId, then constraining the OR
   * clauses to those specific IDs. Exempting matches the pattern we
   * set for every other org-scoped gateway table above.
   *
   * Every other repo method (findById/findByProvider/findAll) still
   * constrains by projectId at the call site; the existing unit
   * tests pin that shape.
   */
  "ModelProvider",
  /**
   * ModelProviderScope (iter 109) is the N:M join table between a
   * ModelProvider row and its (scopeType, scopeId) entries. It has no
   * projectId column — access is always gated through the parent MP
   * (repository replaces the scope set inside a transaction keyed on
   * `modelProviderId`). Same rationale as VirtualKeyProviderCredential.
   */
  "ModelProviderScope",
  /**
   * RoutingPolicy (iter governance-platform) is org-scoped:
   * (organizationId, scope, scopeId, name) is the natural key. Scope
   * may be 'organization' | 'team' | 'project', but the row itself
   * doesn't carry a projectId column. Resolution paths
   * (`resolveDefaultForUser`) query by organizationId + scope +
   * scopeId — projectId enforcement would block the lookup.
   *
   * Same rationale as ModelProvider above (also (scopeType, scopeId)-
   * keyed). Service layer authorises ownership via organizationId
   * before any mutation; the middleware exemption only relaxes the
   * SQL guard.
   */
  "RoutingPolicy",
  /**
   * IngestionSource (iter governance-platform / D2 foundation) is
   * org-scoped: the natural key is (organizationId, name). Optional
   * teamId narrows scope but no projectId — the entire point is a
   * cross-platform feed at the org level. Service layer authorises
   * by organizationId / teamId membership before any mutation.
   */
  "IngestionSource",
  /**
   * AnomalyRule (iter governance-platform / D2 anomaly authoring) is
   * org-scoped: the natural key is (organizationId, name). The rule's
   * `scope` field (organization|team|project|source_type|source) is
   * an EVALUATION-time narrowing, not a tenancy boundary — service
   * layer authorises by organizationId membership before any mutation.
   */
  "AnomalyRule",
  /**
   * AnomalyAlert (iter governance-platform / D2 anomaly detection) is
   * org-scoped persisted detections. Same rationale as AnomalyRule —
   * org-scoped, no projectId, service layer authorises by
   * organizationId before any mutation.
   */
  "AnomalyAlert",
];

const _guardProjectId = ({ params }: { params: Prisma.MiddlewareParams }) => {
  if (params.model && EXEMPT_MODELS.includes(params.model)) return;

  const action = params.action;
  const model = params.model;

  if (
    (action === "findFirst" || action === "findUnique") &&
    model === "PublicShare" &&
    (params.args?.where?.id ||
      (params.args?.where?.resourceType && params.args?.where?.resourceId))
  ) {
    return;
  }

  // Gateway auth resolver: findByHashedSecret is the hot-path lookup
  // that converts an opaque `lw_vk_live_*` bearer token into a
  // VirtualKey row. The hashedSecret itself is a cryptographic
  // identifier unique across the platform (HMAC-SHA256 with a
  // per-deployment pepper), so projectId/organizationId cannot be
  // known to the caller — the VK row IS what teaches them. The OR
  // clause here is always shape
  //   { OR: [{ hashedSecret }, { previousHashedSecret, previousSecretValidUntil }] }
  // matching virtualKey.repository.ts:findByHashedSecret. Narrow
  // exemption matches the PublicShare pattern above.
  if (
    action === "findFirst" &&
    model === "VirtualKey" &&
    Array.isArray(params.args?.where?.OR) &&
    params.args.where.OR.every(
      (o: any) => o?.hashedSecret || o?.previousHashedSecret,
    )
  ) {
    return;
  }

  // Gateway warm-cache resolver: /api/internal/gateway/config/:vk_id
  // hits findUnique({ where: { id: vkId }}) because the gateway
  // already authenticated the VK via resolve-key and now needs the
  // full config payload (keyed by id it learned from the JWT). The
  // HMAC-signed transport + JWT validation upstream is the tenancy
  // check; adding projectId here would require a redundant JWT
  // lookup. Narrow: only findUnique on VirtualKey with a bare id in
  // the where clause — everything else still under the normal guard.
  if (
    action === "findUnique" &&
    model === "VirtualKey" &&
    typeof params.args?.where?.id === "string" &&
    Object.keys(params.args.where).length === 1
  ) {
    return;
  }

  if (action === "create" || action === "createMany") {
    const data =
      action === "create"
        ? params.args?.data
        : params.args?.data?.map((d: any) => d);
    const hasProjectId = Array.isArray(data)
      ? data.every((d) => d.projectId)
      : data?.projectId;

    if (!hasProjectId) {
      throw new Error(
        `The ${action} action on the ${model} model requires a 'projectId' in the data field`,
      );
    }
  } else if (
    !params.args?.where?.projectId &&
    !params.args?.where?.projectId_slug &&
    !params.args?.where?.projectId_date &&
    !params.args?.where?.projectId?.in &&
    !params.args?.where?.OR?.every((o: any) => o.projectId || o.organizationId)
  ) {
    throw new Error(
      params.args?.where?.OR
        ? `The ${action} action on the ${model} model requires that all the OR clauses check for either the projectId or organizationId`
        : `The ${action} action on the ${model} model requires a 'projectId' or 'projectId.in' in the where clause`,
    );
  }
};

export const guardProjectId: Prisma.Middleware = async (params, next) => {
  _guardProjectId({ params });
  return next(params);
};
