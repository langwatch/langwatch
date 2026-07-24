Feature: Ingestion attribution invariant — credential is authoritative; payload is advisory
  Personal-workspace traces, team-workspace traces, and admin-quarantine
  traces all land in ClickHouse via one of four ingestion paths. Each
  path's TenantId stamp comes from the AUTH CREDENTIAL the request was
  authenticated with — NEVER from a payload-side `langwatch.user.id` /
  `team.id` / `project.id` attribute. Trusting payload-side principal
  fields would let an SDK or OTTL transform forge identity, breaking
  the personal-workspace RBAC primitive (which is novel — no other
  observability tool exposes user-as-RBAC; we own the rule).

  Industry-standard alignment: Datadog (org-scoped API key, payload tags
  route within scope), Sentry (DSN per project, projects credential-
  isolated), Honeycomb (API key per environment), Langfuse / Helicone
  (API key per project, traces stamped at receiver). All four converge
  on credential-as-source-of-truth. LangWatch matches.

  Per Sergey's binding doc (4 paths + their TenantId stamp source):

  | Path | Auth credential | Stamps | TenantId resolved at |
  | --- | --- | --- | --- |
  | Gateway VK (`langwatch claude/codex/cursor/gemini`) | `vk-lw-*` (project + owner-scoped) | `langwatch.virtual_key_id`, `langwatch.user.id` | `VK.projectId` (resolved at reactor) |
  | Direct OTLP push (legacy SDK / project-scoped agents) | Project-scoped OTLP auth token | none required (token IS scope) | `token.projectId` |
  | Pull-mode IngestionSource (S3 / copilot_studio / openai_compliance / claude_compliance / workato / cowork / s3_custom / http_custom) | `IngestionSource.ingestSecretHash` | event source already credentialed at puller | `ensureHiddenGovernanceProject(orgId).id` (single org-wide hidden Gov project) |
  | OTel-direct push-mode IngestionSource (`otel_generic`) | `IngestionSource.ingestSecretHash` HMAC | event tagged with `IngestionSource.id` | `ensureHiddenGovernanceProject(orgId).id` |

  Personal-workspace traces flow ONLY through the first two paths (VK or
  direct OTLP project token). IngestionSources are org-admin-only by
  construction — they land in the hidden Governance Project, NEVER in a
  user's Personal Project. There is no IngestionSource composer field
  for `personalProjectId` and adding one is explicitly out of scope per
  master orchestrator's contract lock.

  The hidden Governance Project IS the existing soft quarantine for
  unrecognized / pull-mode traffic. It's admin-readable per
  `governance:view` permission, member-invisible per the Layer-1
  org-scope filter (`94426716e`). Quarantine-fill > threshold fires an
  admin OCSF Alert at /governance.

  Pairs with:
    - specs/ai-gateway/governance/personal-workspace-features.feature  (UX contract)
    - specs/ai-gateway/governance/admin-trace-access.feature           (admin drill-in audit)
    - specs/ai-gateway/governance/ingestion-sources.feature            (IngestionSource model)
    - specs/ai-gateway/governance/architecture-invariants.feature      (TenantId scoping)

  Implementation lives at:
    - langwatch/src/server/governance/activity-monitor/                (reactor + stamping)
    - langwatch/ee/governance/services/governanceProject.service.ts    (hidden Gov)
    - langwatch/src/server/routes/ingest/                              (receivers)
    - langwatch/src/server/governance/ingestion/ottl/                  (OTTL transforms — guard scope)

  Background:
    Given the org has all four ingestion paths active:
      | path                | credential                     |
      | gateway-vk          | `vk-lw-acme_userA_dev`         |
      | direct-otlp         | project-scoped OTLP token      |
      | pull-mode           | IngestionSource S3 puller cred |
      | otel-generic        | IngestionSource HMAC secret    |

  # ---------------------------------------------------------------------------
  # Credential is authoritative — no payload-side override of TenantId
  # ---------------------------------------------------------------------------

  @bdd @ingestion @attribution @security
  Scenario Outline: Receiver stamps TenantId from credential, ignoring payload-side principal fields
    Given an inbound request on path "<path>" authenticated with the
        credential above
    And the payload contains FORGED principal-shaped attributes:
      | attribute             | value                       |
      | langwatch.user.id     | foreign-user-id             |
      | langwatch.team.id     | foreign-team-id             |
      | langwatch.project.id  | foreign-project-id          |
      | tenant.id             | foreign-tenant-id           |
    When the receiver processes the event
    Then the persisted CH row's `TenantId` equals "<expected-tenant>"
    And the forged payload-side principal attributes are either DROPPED
        or PRESERVED-AS-INFORMATIONAL (NOT used for RBAC); the
        canonical RBAC scope is `TenantId` only
    And no row reads `TenantId = foreign-...` on any path

    Examples:
      | path           | expected-tenant                                              |
      | gateway-vk     | the VK's projectId (its `Project.id`, often `isPersonal=true`) |
      | direct-otlp    | the OTLP token's projectId                                   |
      | pull-mode      | `ensureHiddenGovernanceProject(orgId).id`                    |
      | otel-generic   | `ensureHiddenGovernanceProject(orgId).id`                    |

  # S3-pull adapter path covered structurally in tenant-id-tag.unit.test
  # (TenantId = receiver org, never payload-derived). End-to-end bulk
  # import lacks a fixture-pull integration suite; pin as @unimplemented
  # until the puller-adapter integration backfill lands.
  @bdd @ingestion @attribution @security @regression @unimplemented
  Scenario: S3 bulk-import — every imported span lands at hidden Gov, payload user_id never used as TenantId
    Given an admin uploads a S3 fixture via a pull-mode IngestionSource
    And the fixture contains 3 spans with payload-side
        `langwatch.user.id = userA`, `userB`, `userC` respectively
    When the puller worker processes the fixture
    Then all 3 spans' CH rows have `TenantId = ensureHiddenGovernanceProject(orgId).id`
    And NO span's `TenantId` resolves to a user's Personal Project
    And the payload-side `langwatch.user.id` values are preserved as
        searchable attributes (informational) but NEVER promoted to
        the RBAC-load-bearing `TenantId` field
    And users A / B / C — even if they are members of the same org —
        cannot see these spans on their /me Traces explorer (because
        `TenantId` does not match their personalProjectId)
    And the org admin sees these spans only via the hidden Governance
        Project read path (per `governance:view` + the Layer-1 filter)

  # ---------------------------------------------------------------------------
  # OTTL post-auth principal-field guard — the real gap Sergey flagged
  # ---------------------------------------------------------------------------

  @bdd @ingestion @attribution @ottl @security @gap
  Scenario: OTTL transforms run AFTER auth and MUST NOT rewrite tenant-binding fields
    Given a customer has authored an OTTL transform on a pull-mode IngestionSource
    And the transform attempts to set / rewrite ANY of:
      | field                                              |
      | the implicit `TenantId` resolved at receiver auth  |
      | `langwatch.virtual_key_id` (set by gateway VK)     |
      | `langwatch.user.id` (set by gateway VK)            |
      | `langwatch.team.id`                                |
      | `langwatch.project.id`                             |
      | `tenant.id`                                        |
    When the OTTL transform pipeline runs
    Then the rewrite is BLOCKED by the principal-field allowlist OR
        OVERWRITTEN by the post-OTTL re-stamp pass that pins the
        canonical attribution from the auth context
    And the transform is allowed to mutate ANY non-principal-shaped
        attributes (latency / cost / model / tags / resource attrs /
        custom user attrs that don't fit the principal-shaped names)
    And an OCSF event is emitted noting the attempted rewrite
        (so admins see attempted forge attempts in audit)

  # OTTL allowlist is enforced at the transform-step level; the
  # "rewrite cost/latency/url but never tenant-binding fields"
  # invariant has no end-to-end fixture-pull integration test.
  # Pin as @unimplemented until the OTTL backfill suite lands.
  @bdd @ingestion @attribution @ottl @regression @unimplemented
  Scenario: Non-principal OTTL rewrites still work (no over-broad allowlist regression)
    Given an OTTL transform that rewrites NON-principal fields:
      | field                          | rewrite                       |
      | `gen_ai.usage.cost_usd`        | `value * 1.1`                 |
      | `service.name`                 | normalize to lowercase        |
      | `http.url`                     | strip query params            |
      | custom resource attrs          | tag with deployment env       |
    When the transform runs
    Then the rewrites take effect on the persisted CH row
    And the principal-field guard does NOT spuriously block these
        legitimate transforms
    And no OCSF rewrite-attempted event fires for these fields

  # ---------------------------------------------------------------------------
  # Hidden Governance Project — soft quarantine + admin warning
  # ---------------------------------------------------------------------------

  @bdd @ingestion @quarantine @admin
  Scenario: Hidden Gov project is admin-only readable; members cannot enumerate
    Given an org has IngestionSource activity flowing into the hidden Gov project
    When a member with `governance:view = false` calls
        `trace.list({ projectId: <any> })`
    Then the response contains zero rows from the hidden Gov project
        regardless of which projectId they supply (the Layer-1
        member-scope filter at `94426716e` strips hidden-Gov rows
        before the project predicate evaluates)
    And when an admin with `governance:view = true` calls the same
        endpoint with the explicit hidden-Gov projectId
    Then the response contains the rows scoped to that admin's org
    And no cross-org leak: admin in org A sees ONLY org A's hidden Gov

  # Polling Alert + admin-only banner is gated by a flag; UI render-test
  # would need a polling-state mock harness that doesn't exist yet.
  # Pin as @unimplemented until the quarantine-admin UI suite lands.
  @bdd @ingestion @quarantine @admin @regression @unimplemented
  Scenario: Admin warning surfaces when quarantine fill rate exceeds threshold (polling Alert)
    Given >N spans/min are landing in the hidden Gov project for the
        org over a sliding window (default N tuned to alert on
        misconfigured pull-mode pullers, not normal quiescent traffic;
        Lane-S `5fba352c8` calibrated default to 100 spans/min over a
        60s window — above quiescent + healthy-busy, below
        misconfigured-puller loop volume)
    When the `/governance` admin dashboard polls
        `governance.quarantineFillStats({ organizationId })`
    Then the response shape is:
      ```
      { windowSeconds, threshold, spanCount, rate, exceeded, perSource }
      ```
    And when `exceeded === true`, an Alert renders on `/governance`
        for org admins with copy
        "{rate} spans/min landing in quarantine — likely misconfigured ingest"
    And the Alert lists the per-source breakdown so admins can pin
        which source is misconfigured without a separate drill-down
    And no member-side visibility on this Alert — quarantine fills are
        admin-only (Layer-1 filter strips hidden-Gov rows for members
        regardless of any explicit projectId)
    And the Alert path is fail-safe — CH query error returns zero stats
        instead of crashing the dashboard

  @bdd @ingestion @quarantine @admin @follow-up
  Scenario: OCSF auto-emission on threshold-crossed (deferred adoption)
    Given the polling-Alert scenario above is the v1 admin-warning
        surface satisfying this PR's `quarantine_fill_threshold_exceeded`
        invariant
    When future work needs to push the same signal to OCSF for SIEM
        consumption (downstream alerting / pager integration / external
        audit feed)
    Then an OCSF reactor adopting the polling evaluator's signal is
        the canonical extension point — fires
        `category=ingestion class=quarantine_fill_threshold_exceeded
         severity=warning` with the same `metadata` shape as the
        polled response (windowSeconds + perSource)
    And the dedup / re-fire-on-next-window state-machine is part of
        that follow-up; deliberately deferred to allow production data
        to inform the right threshold-tuning + cool-down window before
        committing to a state-machine shape
    # Building block is in place via `governance.quarantineFillStats`;
    # follow-up worker is mechanical adoption when needed.

  # ---------------------------------------------------------------------------
  # NO admin catch-all read backdoor (SOC2 / ISO27001 invariant)
  # ---------------------------------------------------------------------------

  @bdd @ingestion @admin @audit
  Scenario: Admins read user-scoped traces ONLY via audit-logged drill-in (no bypass)
    Given an admin wants to inspect a user's personal-workspace traces
    Then the ONLY supported read path is via the bird's-eye drill-in
        on `/governance` → user row → scoped Traces view (per
        admin-trace-access.feature)
    And every drill-in writes an OCSF audit-log row keyed on
        `actor=adminUserId, action='governance.viewWorkspaceAs',
        target=userId-or-teamId`
    And there is NO bypass surface that returns user traces without
        firing the audit-log row (no `governance.bypassAudit` flag,
        no service-token escape hatch, no SQL-direct access without
        the existing admin-read-of-user-traces audit hook)
    And SOC2 / ISO27001 review evidence: every admin read of
        user-scoped data is captured in the audit log

  # ---------------------------------------------------------------------------
  # Cross-org isolation — receiver-side credential check
  # ---------------------------------------------------------------------------

  @bdd @ingestion @cross-org @security
  Scenario: Cross-org credential reuse is rejected at the receiver
    Given org A has a VK `vk-lw-orgA_userX`
    And org B has a totally separate IngestionSource credential
    When an OTLP push or pull-mode payload arrives at org B's receiver
        carrying org A's `vk-lw-orgA_userX` as auth
    Then the receiver returns 401 (auth failure — credential not in
        org B's credential set)
    And NO row is written to ClickHouse
    And no `TenantId` from org A leaks into org B's data
    And the failed-auth attempt is logged for security telemetry
        (RBAC misuse signal)

  # ---------------------------------------------------------------------------
  # Cross-bind guard parity (per Sergey's commitment to extend Stage B+C
  # aiToolEntry pattern to anywhere a personal user can submit teamId/projectId)
  # ---------------------------------------------------------------------------

  @bdd @ingestion @cross-bind @security
  Scenario: Personal-project users cannot cross-bind to team / foreign projects
    Given a personal-project user (no team membership beyond their Personal Team)
    When they attempt to submit a tRPC mutation that takes a `teamId`
        or a non-personal `projectId` parameter (any router that
        accepts those — `personalWorkspaceFeatures.setForProject`,
        `aiToolEntry.create`, `aiToolEntry.update`, future routers
        that accept either field)
    Then the service-layer guard rejects with FORBIDDEN
    And the rejection happens at the service layer, NOT at the
        permission layer (since the user technically has the
        permission to author their own data — the guard is on the
        *target scope*, not the actor's permission)
    And the same guard pattern is reusable across all routers
        accepting team/project parameters from personal-project
        callers (extends `aiToolEntry` Stage B+C pattern)

  # ---------------------------------------------------------------------------
  # Personal-workspace traces visibility (cross-ref to personal-workspace-features)
  # ---------------------------------------------------------------------------

  @bdd @ingestion @personal-workspace @cross-ref
  Scenario: Personal Workspace traces flow ONLY via VK or direct project OTLP
    Given a user fires `langwatch claude` against their Personal VK
    Then the trace lands at `TenantId = personalProject.id` per the
        gateway-vk path's stamping rule
    And NO IngestionSource composer can be configured to deposit
        traces into a personal project (the IngestionSource model has
        `organizationId` + optional `teamId` only — no `userId` /
        `personalProjectId` field; this is structural per Sergey's
        binding doc, NOT a UI gate)
    And direct OTLP push from the user's local SDK targeting the
        user's personal project token also lands at
        `TenantId = personalProject.id`
    And these are the ONLY two paths into a personal project — any
        future feature that needs ingest-into-personal must add a
        new path with explicit credential-scope plumbing (not extend
        IngestionSource)
