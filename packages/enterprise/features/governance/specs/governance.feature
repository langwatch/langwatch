Feature: Enterprise governance package boundary

  Rule: Governance is the Enterprise AI control plane

    Scenario: Governance orchestrates rather than absorbs infrastructure
      Given gateway, billing, webhook, automation and audit capabilities exist
      When governance enforces an organizational AI policy
      Then governance owns the policy decision and its governance facts
      And technical execution is delegated through narrow capability ports
      And governance does not own those features' transport or persistence engines

    @unit
    Scenario: A new governance subject is deliberate
      Given packages/features/catalogue.json declares every subject governance owns
      And the governance feature.json selects only its layout version
      When governance source introduces a module for a subject the catalogue withholds
      Then architecture lint reports the module and names the feature that owns the subject
      And adding that subject to the governance feature.json is refused in its own right
      And it does not suppress the violation it was written to legitimise
      And the boundary ADR and feature specification describe any catalogue expansion

  @unit
  Scenario: A pull schedule is validated portably
    Given a five-field UTC cron schedule
    When the governance contract validates it
    Then runnable schedules are accepted
    And impossible schedules are rejected

  @unit
  Scenario: Pull outcomes cannot regress the projected cursor
    Given a completed pull has advanced a source cursor
    When an older completion arrives later
    Then the projected cursor remains at the newer completion

  @unit
  Scenario: Governance signals remain idempotent at the event store
    Given a virtual-key lifecycle event or a budget crossing is recorded
    When the same governed fact is submitted again
    Then the lifecycle identity is scoped to its subject and occurrence
    And the budget identity is scoped to its bucket, kind, and period

  @unit
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

  @unit
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

  @unit
  Scenario: Anomaly rule reads are tenant scoped
    Given an anomaly rule belongs to one organization
    When another organization requests that rule by identifier
    Then Governance returns no rule

  @unit
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

  Scenario: Spend spike evaluation does not expose storage syntax
    Given an active spend spike rule targets a source or source type
    When Governance reads the current and baseline spend windows
    Then the feature passes a structured source filter to the spend capability
    And ClickHouse query syntax remains inside the application adapter

  Scenario: Department assignments are organization scoped
    Given a department belongs to one organization
    When an administrator assigns a user, team or project to it
    Then Governance verifies the department and target belong to that organization
    And a missing target is not reported as a successful assignment
    And the department remains an accounting dimension rather than an access grant

  @unit
  Scenario: OCSF export uses a stable compound cursor
    Given Governance has OCSF events ordered by event time and event identifier
    When a security consumer requests an export page
    Then Governance returns the final event time and identifier as the next cursor
    And an organization without a Governance tenant receives an empty page
    And ClickHouse remains behind the injected event reader

  @unit
  Scenario: Ingestion template authoring is tenant safe and auditable
    Given an organization can see platform templates and its own templates
    When an administrator creates, updates, clones or archives a template
    Then Governance validates the template and applies tenant visibility rules
    And each mutation and its audit fact commit in one Postgres transaction
    And a platform template is immutable while a cross-organization template is not found

  Scenario: The platform ingestion template catalog reconciles idempotently
    Given retired platform template rows may remain from an earlier release
    When Governance synchronizes the current platform catalog
    Then every retired platform copy is archived and disabled
    And repeating the synchronization does not create duplicate templates

  Scenario: Request transports reuse the process-owned Governance application
    Given the process composition root has constructed the Governance capabilities
    When a tRPC or Hono request resolves Governance setup state
    Then the transport reads the capability directly from its typed request context
    And it does not construct a service, adapter or database client for the request
    And it does not fall back to a global application lookup

  Scenario: Contracts are transport independent
    Given a browser imports the governance contract root
    Then no server, Eventing, application, environment, or generated database module loads
