Feature: AI Gateway Governance — No-Spy Mode (org-level content stripping)
  As a privacy-locked enterprise admin
  I want a per-organization setting that strips trace content (inputs,
  outputs, chat history, system prompts) BEFORE the trace lands in
  ClickHouse — never persisted, no peek-once-then-redact window
  So that compliance with strict no-employee-spy policies (works councils,
  GDPR sensitive-data, certain financial / healthcare verticals) can be
  guaranteed at infrastructure level, not at presentation level

  Per gateway.md "no-spy mode":
    Three closed modes per `Organization.governanceLogContentMode`:
      `full`       — content kept, default
      `strip_io`   — drop only input/output/messages/system_prompt; keep
                     model name, cost, tokens, latency, errors, status
      `strip_all`  — drop input/output AND any free-text user-supplied
                     attribute the receiver doesn't recognize as safe metadata

  This is DEFENSE-IN-DEPTH: stripping happens in the ingest pipeline
  before the ClickHouse insert, not via projection-time filtering. Once
  data is stripped, there is no recovery path — it was never written.

  Per ingestion-templates-catalog.feature + admin-trace-access.feature:
    No-spy mode applies to EVERY trace ingestion path uniformly:
      • gateway VK proxy traces
      • ingestion-key traces (sk-lw-*, ingest-only ApiKey)
      • IngestionSource pull/push traces
      • Direct OTLP project apiKey traces
    Per-path opt-out is NOT supported — the org-level mode is authoritative.

  Background:
    Given organization "acme-privacy" exists
    And admin "carol@acme-privacy.com" has the `organization:manage` permission
    And the org has at least one personal project, one team project, and
        active gateway VKs / IngestionSources / ingestion keys

  # ---------------------------------------------------------------------------
  # Mode setting + audit
  # ---------------------------------------------------------------------------

  @bdd @no-spy-mode @setting @audit
  Scenario Outline: Admin changes the org-level no-spy mode
    Given the org's current `governanceLogContentMode` is "<from>"
    When carol navigates to /settings/governance and selects the "<to>" mode
    Then `Organization.governanceLogContentMode` is updated to "<to>"
    And an audit row `gateway.organization.governance_log_content_mode_changed`
        is emitted with payload { fromMode: "<from>", toMode: "<to>", actorUserId: carol.id }
    And the row mirrors to the OCSF event log for SOC2 / ISO27001 evidence

    Examples:
      | from      | to         |
      | full      | strip_io   |
      | strip_io  | strip_all  |
      | strip_all | full       |

  # ---------------------------------------------------------------------------
  # Strip-before-ClickHouse — defense-in-depth invariant
  # ---------------------------------------------------------------------------

  @bdd @no-spy-mode @strip-before-ch @defense-in-depth
  Scenario: strip_io mode drops input/output BEFORE the ClickHouse insert
    Given the org's mode is "strip_io"
    When a trace lands via ANY ingestion path with attributes:
      | attribute              | value                                    |
      | gen_ai.request.messages | "[{role: 'user', content: 'my secret'}]" |
      | gen_ai.response.choices | "[{role: 'assistant', content: 'reply'}]"|
      | gen_ai.system          | "anthropic"                              |
      | gen_ai.usage.input_tokens | 42                                    |
      | langwatch.cost.usd     | 0.0021                                   |
    Then the trace is persisted to ClickHouse with:
      | attribute                       | value                                |
      | gen_ai.system                   | "anthropic" (kept)                    |
      | gen_ai.usage.input_tokens       | 42 (kept)                             |
      | langwatch.cost.usd              | 0.0021 (kept)                         |
      | gen_ai.request.messages         | NULL or empty (stripped pre-write)   |
      | gen_ai.response.choices         | NULL or empty (stripped pre-write)   |
    And the original input/output content is NOT recoverable from any
        ClickHouse table — it was never written.

  @bdd @no-spy-mode @strip-all
  Scenario: strip_all mode also drops un-recognized free-text attributes
    Given the org's mode is "strip_all"
    When a trace lands with the attributes from the previous scenario PLUS:
      | attribute                          | value                          |
      | langwatch.user.input.system_prompt | "You are an internal HR bot..." |
      | custom.client.metadata             | "user_email=jane@acme.com"      |
    Then the persisted trace has:
      | attribute                          | persisted? |
      | gen_ai.system                      | yes        |
      | gen_ai.usage.input_tokens          | yes        |
      | langwatch.cost.usd                 | yes        |
      | gen_ai.request.messages            | no         |
      | langwatch.user.input.system_prompt | no         |
      | custom.client.metadata             | no         |

  # ---------------------------------------------------------------------------
  # Cross-path uniformity — every ingestion path obeys
  # ---------------------------------------------------------------------------

  @bdd @no-spy-mode @cross-path @binding-routed
  Scenario: strip_io applies to ingestion-key-routed traces
    Given the org's mode is "strip_io"
    And user "jane@acme-privacy.com" has installed the claude_code template
        and holds ingestion key `sk-lw-KEY_JANE`
    When jane fires a trace through `sk-lw-KEY_JANE`
    Then the trace lands at /me/traces with:
      | attribute                       | value                                                       |
      | gen_ai.usage.* + cost.usd       | populated                                                    |
      | langwatch.origin                | "coding_agent" (receiver-stamped — ingestKeyProvenance 5-key set) |
      | langwatch.organization_id       | acme-privacy.id (receiver-stamped — ingestKeyProvenance)     |
      | langwatch.template.id           | claude_code template id (receiver-stamped — ingestKeyProvenance) |
      | langwatch.api_key.id            | jane's ingestion key id (receiver-stamped — ingestKeyProvenance) |
      | langwatch.source                | "claude_code" (receiver-stamped — ingestKeyProvenance)       |
      | gen_ai.request.messages         | stripped                                                     |
      | gen_ai.response.choices         | stripped                                                     |
    # v1 scope fence: the receiver re-stamps the 5-key ingestKeyProvenance
    # set authoritatively (origin / organization_id / source / template.id
    # / api_key.id). The 16-key B6 attribution set (langwatch.user.id /
    # team.id / organization.id / project.id / tenant_id) is NOT receiver-
    # restamped on ingestion-key-routed traces in v1 — that's v1.1+ deferred
    # work (per MO ruling on Ariana's gap-#6 surfacing post-fc6d54100).
    # Until v1.1+ ships, attribution-key forge attempts in OTLP payloads
    # survive intact through the receiver on the ingest-key path; defense
    # rests on the ingestion key's ingest-only ceiling + receiver-resolved
    # tenancy plus the 5-key ingestKeyProvenance stamp that locks
    # origin + organization_id.
    #
    # Defense against compliance hole: per-trace stripping must consult
    # the trace's effective Organization (resolved from the ingestion
    # key's project.team.organizationId), not just the personalProject's
    # piiRedactionLevel. Spec assertion locks the invariant so future
    # refactors of the receiver pipeline don't silently drop the org-level
    # mode lookup.

  @bdd @no-spy-mode @cross-path @gateway-vk
  Scenario: strip_io applies to gateway VK proxy traces
    Given the org's mode is "strip_io"
    And a gateway VK is provisioned for project "acme-app"
    When a request flows through the gateway VK
    Then the resulting trace persists model + cost + tokens but NOT messages

  @bdd @no-spy-mode @cross-path @ingestion-source
  Scenario: strip_io applies to IngestionSource pull/push traces
    Given the org's mode is "strip_io"
    And an IngestionSource of type "claude_cowork" is configured
    When a pull/push event arrives
    Then the resulting trace persists model + cost + tokens but NOT message bodies

  # ---------------------------------------------------------------------------
  # Mode-change does not retroactively modify existing data
  # ---------------------------------------------------------------------------

  @bdd @no-spy-mode @no-retroactive
  Scenario: Switching to strip_io does NOT retroactively strip past traces
    Given the org has 14 days of traces persisted with full content (mode="full")
    When carol changes the mode to "strip_io"
    Then existing traces are unchanged
    And only NEW traces (post-change-time) are stripped at ingest
    # Retroactive strip would require an admin-initiated ClickHouse rewrite
    # job — out of v1 scope. Audit row makes the cutoff timestamp clear.

  # ---------------------------------------------------------------------------
  # Read-side projection respects mode (defense-in-depth #2)
  # ---------------------------------------------------------------------------

  @bdd @no-spy-mode @read-side
  Scenario: Trace viewer shows a "stripped by org policy" banner when mode is non-full
    Given a trace was stripped at ingest (per mode="strip_io")
    When carol opens the trace at /[project]/messages/[traceId]
    Then the input/output panels show "Content stripped by org no-spy policy. See /settings/governance."
    And the model / cost / tokens / latency panels show their values
    # Distinguishes from PII redaction (per-project) so admins know WHICH
    # policy applied. Both can be active simultaneously.

  # ---------------------------------------------------------------------------
  # Reversibility / governance
  # ---------------------------------------------------------------------------

  @bdd @no-spy-mode @reversibility
  Scenario: A non-admin cannot change governanceLogContentMode
    Given user "ben@acme-privacy.com" has role MEMBER
    When ben tries to PATCH /api/organization/governanceLogContentMode
    Then the response is 403 FORBIDDEN
    And no audit row is emitted

  @bdd @no-spy-mode @cross-org-isolation
  Scenario: governanceLogContentMode change in one org does NOT affect another
    Given two orgs "acme-privacy" (mode=strip_io) and "beta-corp" (mode=full)
    When carol changes acme-privacy to strip_all
    Then beta-corp's mode stays at "full"
    And no events from beta-corp are stripped
