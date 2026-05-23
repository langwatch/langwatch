Feature: AI Gateway Governance — Template OTTL Principal-Field Guard
  As a security reviewer evaluating admin-authored OTTL trust boundaries
  I want a closed `protectedTemplateAttributeKeys` list that template OTTL
  cannot rewrite — receiver re-stamps these keys post-OTTL as authoritative
  So that admins author template mappings (with full power to write canonical
  cost / tokens / model fields, that's the template's job) but they cannot
  weaponize that power to forge user/team/org/project attribution

  Two-list architecture (per the locked contract):
    `protectedAttributeKeys` (B6 base, ALL OTTL paths) — 16 attribution-shaped
        keys (langwatch.user.id / .team.id / .organization.id / .project.id /
        .tenant.id, plus virtual_key + ingestion_source + governance variants)
    `protectedTemplateAttributeKeys` (NEW, template-OTTL only) — 19 keys =
        16 B6 subsumed + langwatch.template.id + langwatch.user_ingestion_binding.id
        + langwatch.source

  NOT in either list (legitimately writable by template OTTL):
    langwatch.cost.usd / .input / .output
    gen_ai.usage.input_tokens / .output_tokens / .total_tokens
    gen_ai.response.model
    Reason: templates exist to parse upstream provider span shapes into the
    canonical gen_ai.* keys. Locking these defeats the template's purpose.
    Trust boundary v1 = platform-team-authored OTTL audited at platform ship
    time. v2 may add tier-of-trust (platform-authored → 19-key list,
    org-authored → 27-key list with cost/token/model lockdown).

  Background:
    Given organization "acme" exists
    And user "jane@acme.com" has personal project "personal-jane"
    And the platform IngestionTemplate "claude_code" exists
    And jane has installed claude_code, holding `ik-lw-TOKEN_JANE`

  # ---------------------------------------------------------------------------
  # Closed key set — exactly 19
  # ---------------------------------------------------------------------------

  @bdd @template-ottl-guard @closed-key-set
  Scenario: protectedTemplateAttributeKeys is a closed set of exactly 19 keys
    When the receiver code is inspected
    Then `protectedTemplateAttributeKeys` is a frozen-at-build-time array
    And its length is exactly 19
    And the contents are:
      | category    | keys                                                                                          |
      | attribution | All 16 B6 protectedAttributeKeys (subsumed)                                                   |
      | provenance  | langwatch.template.id, langwatch.user_ingestion_binding.id, langwatch.source                  |
    And the array is NOT user-extendable, plugin-extendable, or env-overridable

  # ---------------------------------------------------------------------------
  # Forge-attempt rejection — attribution category
  # ---------------------------------------------------------------------------

  @bdd @template-ottl-guard @forge-attempt @attribution
  Scenario: Template OTTL attempts to rewrite attribution key — rejected + audited
    Given a hypothetical malicious template OTTL contains a statement that
        sets langwatch.user.id = "different.user@acme.com"
    When jane fires a trace under that template using `ik-lw-TOKEN_JANE`
    Then the receiver applies the OTTL rule under the principal-field guard
    And the post-OTTL re-stamp pass overwrites langwatch.user.id back to jane.id
    And the trace lands with langwatch.user.id = jane.id
    And an audit row `gateway.template_ottl_protected_field_attempt` is emitted with payload:
      | field          | value                                                  |
      | rejectedKeys   | ["langwatch.user.id"]                                  |
      | templateId     | (the malicious template's id)                          |
      | bindingId      | jane's binding id                                      |
      | category       | "attribution"                                          |

  # ---------------------------------------------------------------------------
  # Forge-attempt rejection — provenance category
  # ---------------------------------------------------------------------------

  @bdd @template-ottl-guard @forge-attempt @provenance
  Scenario: Template OTTL attempts to rewrite provenance keys — rejected + audited
    Given a hypothetical malicious template OTTL contains statements that set:
      | key                                  | value                  |
      | langwatch.template.id                | "different-template-id"|
      | langwatch.user_ingestion_binding.id  | "different-binding-id" |
      | langwatch.source                     | "different-source"     |
    When jane fires a trace under that template using `ik-lw-TOKEN_JANE`
    Then the post-OTTL re-stamp pass overwrites all 3 keys back to authoritative values
    And the trace lands with provenance keys reflecting jane's actual binding + template + source
    And ONE audit row `gateway.template_ottl_protected_field_attempt` is emitted
        with rejectedKeys = the 3 keys above (single audit row per attempt, not 3)

  # ---------------------------------------------------------------------------
  # Cost / tokens / model — legitimately writable (NOT in protected list)
  # ---------------------------------------------------------------------------

  @bdd @template-ottl-guard @writable @canonical-output
  Scenario: Template OTTL legitimately writes canonical cost / tokens / model — NO rejection
    Given the platform claude_code template's OTTL maps:
      | source attr                     | dest attr                       |
      | anthropic.usage.input_tokens    | gen_ai.usage.input_tokens       |
      | anthropic.usage.output_tokens   | gen_ai.usage.output_tokens      |
      | gen_ai.system                   | gen_ai.system                   |
    When jane fires a trace under this template
    Then the OTTL rules execute without rejection
    And the trace lands with gen_ai.usage.input_tokens populated from anthropic.usage.input_tokens
    And gen_ai.usage.output_tokens populated from anthropic.usage.output_tokens
    And NO audit row is emitted (legitimate canonical-output writes are not protected-key-attempts)

  # ---------------------------------------------------------------------------
  # B6 base set survives — receiver re-stamp ordering
  # ---------------------------------------------------------------------------

  @bdd @template-ottl-guard @b6-base-set
  Scenario: B6 base protectedAttributeKeys also survive in template OTTL paths
    Given the B6 16-key set includes langwatch.tenant.id
    And a hypothetical malicious template OTTL sets langwatch.tenant.id = "personal-ben"
    When jane fires a trace through that template using `ik-lw-TOKEN_JANE`
    Then the receiver re-stamps langwatch.tenant.id = "personal-jane" (jane's binding tenantId)
    And the trace lands at jane's /me/traces
    And the audit row's rejectedKeys array contains "langwatch.tenant.id"
    # B6 set applies on ALL OTTL paths; template list is a superset that
    # also covers provenance.

  # ---------------------------------------------------------------------------
  # Receiver re-stamp ordering — must be POST-OTTL
  # ---------------------------------------------------------------------------

  @bdd @template-ottl-guard @ordering @post-ottl
  Scenario: Re-stamp pass runs AFTER template OTTL (not before)
    When the receiver flow is inspected
    Then the order of operations is:
      | step | operation                                                  |
      | 1    | prefix-discriminate token + lookup binding                 |
      | 2    | defense-in-depth re-verify                                 |
      | 3    | apply template.ottlRules with snapshot+restore principal-field guard |
      | 4    | post-OTTL re-stamp 19-key protectedTemplateAttributeKeys   |
      | 5    | canonicalCostExtractor derives langwatch.cost.usd          |
      | 6    | handoff to trace pipeline                                  |
    # Re-stamp MUST be post-OTTL because the principal-field guard during
    # OTTL is the snapshot+restore wrapper from B6.4; the post-OTTL pass is
    # the authoritative-attribution stamp that owns the 19 keys regardless
    # of what OTTL tried.

  # ---------------------------------------------------------------------------
  # No env / config / plugin extensibility on the protected list
  # ---------------------------------------------------------------------------

  @bdd @template-ottl-guard @no-extensibility
  Scenario: protectedTemplateAttributeKeys is NOT env-overridable or plugin-extendable
    When the codebase is grepped for "protectedTemplateAttributeKeys"
    Then it is defined ONCE as a `const` array with `as const` typing
    And no env variable can extend, override, or shrink it
    And no plugin / config-file / runtime mechanism can mutate it
    # Closed-list-as-code, frozen-at-build invariant. Mirrors the B6
    # protectedAttributeKeys discipline.
