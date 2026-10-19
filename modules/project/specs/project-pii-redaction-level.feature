Feature: A project's PII redaction level on the management API
  `GET` and `PATCH /api/projects/{id}` carry `piiRedactionLevel`, as the MCP
  `platform_get_project` and `platform_update_project` tools and the CLI read
  and send it. Data privacy owns the level as the project's own scoped rule;
  the door reads and writes it through `DataPrivacyApi`, never the rule itself.
  What the level means is data privacy's: modules/data-privacy/specs/data-privacy-service.feature.

  @unit
  Scenario: Reading a project answers its PII redaction level
    Given a project in the credential's organization
    When the project is read
    Then the response carries the PII redaction level data privacy holds for it

  @unit
  Scenario: Updating a project's PII redaction level writes it through data privacy
    Given a project in the credential's organization
    When the project is patched with a new name and the PII redaction level STRICT
    Then the name is written first and the level is written through data privacy
    And the response carries the new name and the PII redaction level STRICT

  @unit
  Scenario: A PATCH without a PII redaction level leaves it alone
    Given a project in the credential's organization
    When the project is patched with only a new name
    Then no PII redaction level is written

  @unit
  Scenario: An unknown PII redaction level is refused before anything is written
    When a project is patched with a PII redaction level other than STRICT, ESSENTIAL or DISABLED
    Then the request is refused as invalid
    And neither the project nor its level is written

  @unit
  Scenario: A PII redaction level for a project outside the organization is never written
    Given a project that is not in the credential's organization
    When the project is patched with a PII redaction level
    Then the request is refused as not found
    And no PII redaction level is written
