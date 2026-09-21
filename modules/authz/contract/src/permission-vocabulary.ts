/**
 * Action and resource vocabulary shared across browser and server; kept import-
 * free. Registry decides what permissions mean; this table is a UI subset only.
 */

/**
 * Core actions that can be performed on resources
 */
export const Actions = {
  VIEW: "view",
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
  MANAGE: "manage", // Full CRUD + settings
  SHARE: "share",
  // Gateway-specific actions: `rotate` is a sub-action of `update` for virtual
  // keys but callers may want to grant it independently. `attach`/`detach`
  // apply to guardrails — these are also treated as sub-actions of `update`
  // by the hierarchy helper below.
  ROTATE: "rotate",
  ATTACH: "attach",
  DETACH: "detach",
  // Resource-specific cross-principal audit action. Used today by
  // `virtualKeys:viewOtherPersonal` so org admins can see every member's
  // personal VKs during off-boarding sweeps. Personal-VK self-view stays
  // implicit on principalUserId match (no perm needed for "see my own").
  VIEW_OTHER_PERSONAL: "viewOtherPersonal",
} as const;

export type Action = (typeof Actions)[keyof typeof Actions];

/**
 * Resources in the system that can have permissions
 */
export const Resources = {
  ORGANIZATION: "organization",
  PROJECT: "project",
  TEAM: "team",
  ANALYTICS: "analytics",
  COST: "cost",
  TRACES: "traces",
  SCENARIOS: "scenarios",
  ANNOTATIONS: "annotations",
  EVALUATIONS: "evaluations",
  DATASETS: "datasets",
  TRIGGERS: "triggers",
  WORKFLOWS: "workflows",
  // Experiments are their own capability: a user can run experiments on
  // prompts or agents without touching the workflow studio. Historically they
  // inherited `workflows:view`; this dedicated permission decouples them.
  EXPERIMENTS: "experiments",
  PROMPTS: "prompts",
  SECRETS: "secrets",
  PLAYGROUND: "playground",
  OPS: "ops",
  // Platform audit log — covers both the legacy AuditLog stream AND the
  // gateway-resource rows folded into it by the audit consolidation.
  // Lives outside the gateway permission family because it gates a
  // platform settings page (/settings/audit-log), not a gateway sub-page.
  AUDIT_LOG: "auditLog",
  // AI Gateway resources — see specs/ai-gateway/_shared/contract.md §10
  VIRTUAL_KEYS: "virtualKeys",
  GATEWAY_BUDGETS: "gatewayBudgets",
  GATEWAY_PROVIDERS: "gatewayProviders",
  // RoutingPolicies are Enterprise-tier gateway primitives (provider
  // chain + fallback + per-model rules). Granular permission lets
  // custom roles delegate routing-policy mgmt without granting
  // organization:manage. Mirrors gatewayProviders:* shape.
  ROUTING_POLICIES: "routingPolicies",
  GATEWAY_GUARDRAILS: "gatewayGuardrails",
  // Deprecated (kept for backwards-compat): pre-consolidation perm that
  // gated /[project]/gateway/audit. The page is gone; auditLog:view is
  // the live permission. Safe to drop in a future breaking-change pass.
  GATEWAY_LOGS: "gatewayLogs",
  GATEWAY_USAGE: "gatewayUsage",
  GATEWAY_CACHE_RULES: "gatewayCacheRules",
  // AI Governance resources — see specs/ai-gateway/governance/. These are
  // org-level (not project/team-level), so they live in
  // ORGANIZATION_ROLE_PERMISSIONS rather than the team role bags. Custom
  // roles can grant any subset via the existing CustomRolePermissions JSON
  // column without requiring a Prisma enum change.
  GOVERNANCE: "governance",
  INGESTION_SOURCES: "ingestionSources",
  ANOMALY_RULES: "anomalyRules",
  COMPLIANCE_EXPORT: "complianceExport",
  ACTIVITY_MONITOR: "activityMonitor",
  // AI Tools Portal (Phase 7) — the customizable per-org card grid on /me.
  // aiTools:view → ALL org roles (discover + click through to setup).
  // aiTools:manage → org ADMIN only (catalog editor at /governance/tool-catalog).
  AI_TOOLS: "aiTools",
  // Outbound webhook endpoints (the webhook platform). Org-tier only:
  // endpoints are org-anchored, carry signing secrets, and stream every
  // enabled event family out of the platform, so granting them below the
  // org tier would let a project-scoped role exfiltrate org-wide data.
  // Enterprise-gated at the plan layer on top of the permission.
  WEBHOOK_ENDPOINTS: "webhookEndpoints",
  // The spend reconciliation surface (spend-events pull + per-end-user
  // rollups). Org-tier and separate from webhookEndpoints: reading the
  // metered ledger is a strictly weaker capability than managing outbound
  // delivery, and billing consumers get keys that can ONLY read. Same
  // enterprise plan gate as the webhook platform.
  GATEWAY_SPEND: "gatewaySpend",
  // Langy: provisioning and running turns (separate from evaluations:view).
  // Project-scoped; org-scoped langy:manage in ORG role bag.
  LANGY: "langy",
  // Per-project agent cache; manage guards all routes (read+write unified).
  // MEMBER upward only; entries are agent-written state.
  AGENT_CACHE: "agentCache",
  // Organization cost screen (ADR-128): provider-billed, gateway-metered,
  // and seat lanes. Read-only; separate from governance:* (ADR-128).
  GOVERNANCE_COST: "governanceCost",
  // Single sign-on and the directory that provisions against it (D05,
  // ADR-122). Organization-tier only: a connection decides how EVERYONE in
  // the organization signs in.
  SSO: "sso",
} as const;

export type Resource = (typeof Resources)[keyof typeof Resources];
