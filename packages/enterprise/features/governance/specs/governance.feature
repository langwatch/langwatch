Feature: Enterprise governance package boundary

  Rule: Governance is the Enterprise AI control plane

    Scenario: Governance orchestrates rather than absorbs infrastructure
      Given gateway, billing, webhook, automation and audit capabilities exist
      When governance enforces an organizational AI policy
      Then governance owns the policy decision and its governance facts
      And technical execution is delegated through narrow capability ports
      And governance does not own those features' transport or persistence engines

    Scenario: A new governance subject is deliberate
      Given the governance package has declared source subjects
      When source for a new subject is added
      Then architecture lint rejects it until feature.json declares the subject
      And the boundary ADR and feature specification describe its ownership

  Scenario: A pull schedule is validated portably
    Given a five-field UTC cron schedule
    When the governance contract validates it
    Then runnable schedules are accepted
    And impossible schedules are rejected

  Scenario: Pull outcomes cannot regress the projected cursor
    Given a completed pull has advanced a source cursor
    When an older completion arrives later
    Then the projected cursor remains at the newer completion

  Scenario: Pulled usage keeps money lossless
    Given a provider-reported decimal USD value
    When governance prices the observation
    Then the result is an exact integer nano-USD value
    And values outside the safe JSON integer range are rejected

  Scenario: Governance owns its persona-home decision
    Given the application has loaded organization intent and governance setup state
    When the portable persona-home policy resolves the user's destination
    Then governance chooses between the governance and project homes
    And the application remains responsible for authentication and redirect transport

  Scenario: Governance evaluates quarantine fill without owning trace storage
    Given the application supplies a governance tenant and trace-activity reader
    When governance evaluates the current quarantine fill window
    Then governance computes the per-source rate and warning threshold
    And ClickHouse access remains behind the injected trace-activity capability

  Scenario: Anomaly rules are validated before persistence
    Given an administrator supplies an anomaly rule configuration
    When Governance creates or updates the rule
    Then the rule scope, severity, threshold and destinations are validated by the Governance contract
    And Postgres access remains behind the Governance server repository

  Scenario: Anomaly rule reads are tenant scoped
    Given an anomaly rule belongs to one organization
    When another organization requests that rule by identifier
    Then Governance returns no rule

  Scenario: Spend spike decisions are deterministic
    Given a valid spend spike threshold and current and baseline spend windows
    When Governance evaluates the threshold
    Then an existing open alert takes precedence over another firing
    And the decision fires only when the minimum baseline and configured ratio are met

  Scenario: Anomaly delivery delegates network safety
    Given a fired anomaly has one or more webhook destinations
    When Governance dispatches the alert
    Then Governance signs the exact payload and applies bounded retries
    And every destination produces an auditable outcome
    And the application supplies the SSRF-safe HTTP adapter

  Scenario: Contracts are transport independent
    Given a browser imports the governance contract root
    Then no server, Eventing, application, environment, or generated database module loads
