Feature: AI Gateway Governance — Template Cross-Bind Guard
  As a security reviewer
  I want a service-layer guarantee that user A cannot bind to user B's
  personal project — neither at install time nor at receive time
  So that the binding-as-scope invariant survives pathological inputs and
  no enumeration vector exists for cross-user trace landing

  Two-layer guard (per the locked contract):
    1. STRUCTURAL impossibility at install — bindingService.install input
       schema has no personalProjectId field. Server resolves via
       getPersonalProjectForUser(userId, organizationId) where userId comes
       from `ctx.session.user.id` (authentication context) and organizationId
       is the caller's active-workspace input. Cross-user binding is
       unrepresentable in the input shape.
    2. RUNTIME guard at receive — token-as-scope. If user A presents
       ik-lw-TOKEN_A and the payload claims TenantId=user_B's personalProject,
       the receiver re-stamps to user A's bound personalProjectId via the
       protectedTemplateAttributeKeys (19-key) post-OTTL guard. Forge attempt
       emits `gateway.template_ottl_protected_field_attempt` audit row.

  Background:
    Given organization "acme" exists
    And user "jane@acme.com" has personal project "personal-jane"
    And user "ben@acme.com" has personal project "personal-ben"
    And both users have installed the claude_code template, holding
        `ik-lw-TOKEN_JANE` and `ik-lw-TOKEN_BEN` respectively

  # ---------------------------------------------------------------------------
  # Layer 1 — structural impossibility at install
  # ---------------------------------------------------------------------------

  @bdd @cross-bind-guard @structural-impossibility @install
  Scenario: Install RPC input schema does NOT accept personalProjectId
    When the bindingService.install Zod schema is inspected
    Then the input shape is exactly:
      """
      { templateId: string, organizationId: string, ...credentialSchemaFields }
      """
    And the input shape MUST NOT include a `personalProjectId` field
    And userId is read from `ctx.session.user.id` (authentication context, not input)
    And the server resolves personalProjectId via `getPersonalProjectForUser(userId, organizationId)`
    # Cross-user binding becomes unrepresentable — no enumeration vector
    # because there's no field to populate with another user's projectId.

  @bdd @cross-bind-guard @structural-impossibility @input-rejection
  Scenario: Even if the wire payload is hand-crafted with personalProjectId, it is ignored
    Given jane crafts a malicious tRPC payload to bindingService.install
        with extra field personalProjectId="personal-ben"
    When the call hits the server
    Then Zod's strict mode rejects the unrecognized key with a 400 BAD_REQUEST
    Or (if loose mode) the server simply ignores the extra field and resolves
        personalProjectId from `getPersonalProjectForUser(jane.id, "acme")` = "personal-jane"
    And under no condition does the resulting binding row have personalProjectId="personal-ben"

  # ---------------------------------------------------------------------------
  # Layer 2 — runtime guard at receive (token-as-scope)
  # ---------------------------------------------------------------------------

  @bdd @cross-bind-guard @token-as-scope @forge-attempt
  Scenario: Forge attempt — payload claims TenantId=other-user, receiver re-stamps
    When jane fires an OTLP payload using `ik-lw-TOKEN_JANE` with malicious resource attrs:
      | attribute                          | value           |
      | langwatch.tenant.id                | "personal-ben"  |
      | langwatch.user.id                  | ben.id          |
      | langwatch.project.id               | "personal-ben"  |
    Then the receiver:
      | step | action                                                              |
      | 1    | resolves TOKEN_JANE → jane's binding → tenantId = "personal-jane"   |
      | 2    | applies template OTTL (under principal-field guard)                 |
      | 3    | post-OTTL re-stamps the 19-key protectedTemplateAttributeKeys       |
      | 4    | langwatch.tenant.id = "personal-jane" (re-stamped)                  |
      | 5    | langwatch.user.id   = jane.id        (re-stamped)                   |
      | 6    | langwatch.project.id = "personal-jane" (re-stamped)                 |
      | 7    | emits audit row `gateway.template_ottl_protected_field_attempt`     |
    And the trace lands at jane's /me/traces (NOT ben's)
    And the audit row payload contains the rejected key list:
        [langwatch.tenant.id, langwatch.user.id, langwatch.project.id]

  @bdd @cross-bind-guard @token-as-scope @cross-user-receive
  Scenario: User A's token cannot deliver traces to user B's project under any payload manipulation
    When jane fires N OTLP payloads with various forge-attempt variants using `ik-lw-TOKEN_JANE`
    Then ALL N traces land at jane's /me/traces (personalProjectId="personal-jane")
    And ZERO traces land at ben's /me/traces

  # ---------------------------------------------------------------------------
  # No-enumeration — collapse-to-NOT_FOUND on cross-org probes
  # ---------------------------------------------------------------------------

  @bdd @cross-bind-guard @no-enumeration
  Scenario: Cross-org binding-install probe collapses to NOT_FOUND (no enumeration vector)
    Given user "lisa@beta-corp.com" attempts to install templateId pointing at
        an "acme"-org-scoped template
    When the bindingService.install resolves
    Then the response is 404 NOT_FOUND (templateId not visible to her org)
    And NOT 403 FORBIDDEN (which would leak existence)
    # Mirrors the PersonalProjectOwnerMismatchError collapse-to-NOT_FOUND
    # pattern from B6 — no SOC2-relevant enumeration vector.

  # ---------------------------------------------------------------------------
  # Defense-in-depth — row-level integrity check survives DB tampering
  # ---------------------------------------------------------------------------

  @bdd @cross-bind-guard @defense-in-depth
  Scenario: Receiver re-verifies binding row integrity at every receive
    Given jane's binding row has been manually tampered (out-of-band SQL) so
        binding.personalProjectId now points at ben's project, but
        binding.userId still equals jane.id
    When jane fires a trace using `ik-lw-TOKEN_JANE`
    Then the receiver's defense-in-depth re-verify step fails:
        binding.personalProject.team.ownerUserId !== binding.userId
    And the receiver returns 401 with no body content
    And an audit row `gateway.user_ingestion_binding.integrity_violation` is emitted
    And the tile renders "Binding broken — contact support"
    # Cross-bind guard is enforced row-level at every receive, not just at
    # install. SQL-level tampering does NOT escape the guard.
