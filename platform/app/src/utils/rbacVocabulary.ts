/**
 * The action and resource vocabulary a permission string is built from.
 *
 * A leaf module on purpose: it imports nothing, so both halves of the app can
 * read it. The settings UI needs these to render the permission picker, and
 * `server/api/rbac.ts` needs them to build permission strings — but rbac.ts
 * also reaches the engine gate, and through it a Node-only logger. When these
 * constants lived there, importing them from a React component pulled pino
 * into the browser bundle and every chunk died on `process is not defined`.
 *
 * So the rule this file exists to hold: a value both sides share lives
 * somewhere neither side owns. Keep it free of imports.
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
  // AI Tools Portal (Phase 7) — the customizable per-org card grid on
  // /me. Two permissions:
  //   - aiTools:view → ALL org roles. Portal must work for every member
  //     so they can discover what's available + click through to setup.
  //   - aiTools:manage → org ADMIN only. Catalog editor surface at
  //     /governance/tool-catalog (CRUD + reorder + enable).
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
  // The Langy in-product assistant. Its own resource rather than riding on
  // `evaluations:view`, because starting a turn is not a read: it provisions
  // credentials, spawns an OpenCode worker and spends the project's model
  // budget. `langy:view` reads conversations; `langy:create` starts or
  // continues a turn (and forks, which creates one); `langy:update` renames;
  // `langy:delete` archives. Project-scoped, since conversations belong to a
  // project — except `langy:manage`, which also appears in the ORG role bag
  // for the Langy surfaces an admin configures. The organization's GitHub
  // connection is not one of them: it belongs to the organization, so
  // `organization:manage` gates it
  // (specs/integrations/github-connection.feature).
  //
  // Granted from MEMBER upward, and to org admins; VIEWER and EXTERNAL get
  // nothing. The permission grain is not what keeps Langy scarce — the
  // `release_langy_enabled` flag is — so it draws the line at "can this person
  // act on the project at all" rather than trying to be finer than that.
  LANGY: "langy",
} as const;

export type Resource = (typeof Resources)[keyof typeof Resources];
