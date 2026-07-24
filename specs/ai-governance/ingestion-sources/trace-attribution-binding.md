# Trace attribution binding contract

Authoritative reference for how an inbound trace's `TenantId` (and downstream
`workspaceUserId` / `teamId`) is determined at the receiver layer. Cited by
`ingestion-attribution.feature` and the personal-workspace + admin-trace-access
specs.

## The rule

**The credential carries the scope. The trace payload does not.**

Whoever holds the credential (VK, project OTLP token, IngestionSource
`ingestSecretHash`) has already declared the scope at the moment of
authentication. Payload-side fields like `langwatch.user.id`,
`langwatch.team.id`, or `service.namespace` are **informational** — searchable
attributes, not authoritative bindings. The receiver stamps tenancy from the
credential's resolved scope; payload-side principal-shaped attributes are
clamped, dropped, or overwritten before storage.

This is the standard for every multi-tenant observability platform we
benchmarked against (Datadog API key → org; Sentry DSN → project; Honeycomb
API key → environment; Langfuse / Helicone API key → project).

## The four ingestion paths today

| Path | Auth credential | Stamps applied | Resolved `TenantId` |
|---|---|---|---|
| Gateway VK (`langwatch claude/codex/cursor/gemini` wrappers) | `vk-lw-*` (project + owner-scoped) | `langwatch.virtual_key_id`, `langwatch.user.id` | `VK.projectId` (resolved at reactor side) |
| Direct OTLP push (legacy SDK) | Project-scoped OTLP auth token | none required (token IS scope) | `token.projectId` |
| Pull-mode IngestionSource (`s3_custom`, `copilot_studio`, `openai_compliance`, `claude_compliance`, `workato`, `claude_cowork`, `http_custom`) | `IngestionSource.ingestSecretHash` (puller-side) | n/a — event source already credentialed at the puller | `ensureHiddenGovernanceProject(orgId).id` |
| OTel-direct push IngestionSource (`otel_generic`) | `IngestionSource.ingestSecretHash` HMAC | event tagged with `IngestionSource.id` | `ensureHiddenGovernanceProject(orgId).id` |

## Implications

- **Personal-project traces flow ONLY via the gateway VK or direct OTLP
  project token paths.** `IngestionSource` never lands traces in a personal
  project — it always lands in the org's single hidden Governance project.
- The hidden Governance project (minted by `ensureHiddenGovernanceProject`)
  serves as the soft quarantine for unrecognized / IngestionSource-routed
  traffic. Members cannot read it (Layer-1 governance filter strips it from
  member-facing reads). Org admins read via `governance:view`.
- **No admin catch-all read backdoor into personal-project traces.** Admins
  can read personal-project traces only via the bird's-eye drill-through
  (which is audit-logged). There is no surface that bypasses the audit trail.
- Cross-org leakage is structurally prevented: every CH query filters by
  `WHERE TenantId = {tenantId:String}`, and `TenantId` is derived from the
  authenticated credential, never from the payload.

## Known gaps to close

- **OTTL post-auth attribute guard.** OTTL transforms run after the receiver
  resolves `TenantId` from the credential, but there is no allowlist
  preventing OTTL rules from rewriting principal-binding attributes
  (`langwatch.user.id`, `langwatch.team.id`, `service.namespace`,
  `tenant_id`-shaped fields). A misconfigured OTTL rule could rewrite
  attribution to point at a foreign user. Mitigation: post-OTTL re-stamp
  pass that overwrites principal-binding attributes from the credential's
  resolved scope, OR a pre-OTTL allowlist that rejects rules touching those
  fields.
- **Quarantine fill rate observability.** When traffic lands in the hidden
  Governance project at high rate, that's typically a misconfigured ingest.
  A reactor that counts spans/min into the quarantine and surfaces an admin
  Alert at `>N spans/min within window` is the warning surface.
- **Cross-bind guard for personal-user IngestionSource creators.** When
  introducing per-user IngestionSource scoping in the future, the service
  layer must reject a personal-project user from binding to a `teamId` or
  `projectId` outside their personal-project set. The pattern lives in
  `aiToolEntry.service.ts` already and can be extended.

## Personal-project trace ingestion — recommended user path

For the personal-workspace trace explorer to receive traces, the user MUST
go through one of the two scoped-credential paths:

1. **Gateway VK** — issue a personal VK via `langwatch claude` (or
   equivalent), fire requests through the gateway. Gateway stamps
   `langwatch.virtual_key_id`; reactor resolves to the personal project's
   `TenantId`. **This is the primary path.**
2. **Direct OTLP push to the personal project's OTLP endpoint** — the
   project's OTLP auth token carries the scope. Same `TenantId` resolution
   as any other project.

Pull-mode IngestionSource (`copilot_studio`, `s3_custom`, etc.) does NOT
land in personal projects. That is a deliberate scoping decision: governance
ingestion is org-admin territory, personal ingestion is user-VK territory.
