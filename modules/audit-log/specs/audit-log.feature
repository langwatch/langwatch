Feature: Audit logging
  Security-sensitive application actions are recorded through one portable
  capability without exposing request-framework or persistence types. Every
  deployment records audit entries (ARCHITECTURE.md section 4, 2026-09-24), and
  the home screen's recent-items strip is read from the caller's own entries.

  @unit
  Scenario: A recorded entry is readable as the entity's history
    Given a process that installed the audit log
    When a management write is recorded against an entity
    Then the entity's history names the actor and the action

  @unit
  Scenario: Entity history stays inside the requested project and action family
    Given audit entries name an entity in id, agentId or newAgentId arguments
    And other projects and action families have entries naming the same entity
    When the caller lists that project's agents history with those argument keys
    Then only matching project and action entries are returned newest first
    And the requested history limit is applied
    And stored author identifiers remain available for caller-owned enrichment

  @unit
  Scenario: A trail lists the entries recorded under its target kind, newest first
    Given audit entries recorded under one target kind and under another
    When the caller reads that target kind's trail with a limit
    Then only entries of that kind come back, newest first, at most the limit
    And a project, target or actor the entry did not record reads as null

  @unit
  Scenario: A target kind nothing was recorded under lists nothing
    Given audit entries recorded under other target kinds
    When the caller reads the trail of a kind nothing was recorded under
    Then the trail is empty, not refused

  @unit
  Scenario: A trail read with an empty target kind or a non-positive limit is refused
    Given an audit service
    When the caller reads a trail with an empty target kind, a zero limit or a fractional limit
    Then the read is refused as invalid input before the repository is asked

  @unit
  Scenario: A memory process's trail lists what its own audit log recorded
    Given a process that installed the audit log over memory stores
    When operator acts are recorded through the audit log
    Then reading their target kind's trail lists them, newest first

  @unit
  Scenario: A valid audit command is persisted
    Given an audit service with a repository
    When a caller records an action with JSON arguments and request metadata
    Then one bounded audit record is written

  @unit
  Scenario: Secret-bearing argument values are never stored
    Given an audit service with a repository
    When a caller records an action whose arguments carry a password, a token and an API key
    Then those values are stored as redacted, at any depth
    And a key naming a secret or a hash anywhere in it, in any case or separator style, plural or hashed, is redacted too
    And keys that only identify, name, count or date a secret, such as apiKeyId, tokenId and secretName, are stored unchanged
    And the actor, the action, the target and every other argument are stored unchanged

  @unit
  Scenario: the home strip answers an empty trail with no items
    Given the audit log installed over memory repositories
    When somebody with no recent activity reads the home strip
    Then they are answered with no items

  @unit
  Scenario: the home strip answers each touched entity once, newest first
    Given somebody touched a workflow twice, a prompt, a monitor, an annotation queue and a dataset
    When they read the home strip
    Then each entity is answered once, by id and type, at its newest touch, newest first
    And the browser names and links each from its owner's list

  @unit
  Scenario: the home strip never answers simulations
    Given somebody touched a workflow and a simulation
    When they read the home strip
    Then only the workflow is answered

  @unit
  Scenario: the home strip shows only the caller's own touches
    Given somebody else touched a workflow in the project
    When the caller reads the home strip
    Then that workflow is not listed

  @integration
  Scenario: the composed api process keeps its audit entries in the installed audit-log module
    Given the api process composed as its main composes it, over memory stores
    When an audit entry is recorded for a prompt
    Then the prompt's history answers that entry

  @unimplemented
  Scenario: a browser mutation's audit entry reaches the home strip in the composed api process
    Given the api process composed with the audit-log module
    When somebody updates a workflow through the browser door
    Then the audit trail records the mutation
    And their home strip lists the workflow

  Rule: A producer's audit goes through its own outbox after commit (Alex, Q72, 2026-10-06)
    The producer records an audit intent, keyed by an audit id it mints once, in its own commit
    (Alex, audit R1: the intent shares the domain change's transaction). Its outbox calls
    AuditLogApi.record after commit and retries until the row is written. The key lives in its own
    unique column; every row keeps the table's one id scheme (Alex, audit R2).

    @unit
    Scenario: A keyed audit entry recorded twice writes one row
      Given an audit intent keyed by an audit id
      When the producer's outbox delivers it twice
      Then one audit row is stored under that key
      And both deliveries answer the same row

    @unit
    Scenario: A keyed audit row takes the table's own id, not its key
      Given an audit intent keyed by an audit id
      When the producer's outbox delivers it
      Then the row's id is not the key
      And the row records the key as its idempotency key

    @unit
    Scenario: A keyed audit entry keeps the moment the producer committed it
      Given an audit intent keyed by an audit id minted when the producer committed
      When the outbox delivers it later
      Then the row's time is the moment in the key, not the delivery's

    @unit
    Scenario: An audit key that is not an audit id is refused
      When a caller records an entry keyed by an id of another kind
      Then nothing is written and the call fails

    @integration
    Scenario: Concurrent deliveries of one keyed audit entry store one row
      Given an audit intent keyed by an audit id
      When two deliveries of it race against Postgres
      Then one audit row is stored under that key

    @unit
    Scenario: A failed audit delivery is retried from the producer's outbox
      Given a producer recorded an audit intent in its own commit
      When the first delivery to the audit log fails
      Then the outbox delivers it again and the audit row is written once

    @integration
    Scenario: A rolled-back change records no audit
      Given a producer whose domain change and audit intent share one commit
      When that commit rolls back
      Then no audit intent is left in its outbox and no audit row is written

  Rule: Audit-log reacts to organization's audit facts (Alex, 2026-10-06, night, second round)
    Organization appends an audit intent in the transaction of its change; its outbox records the
    audit fact on organization's own pipeline, and audit-log's peer subscriber writes its own table
    (record section 9). Organization holds no audit-log peer and never writes the audit table.

    @integration
    Scenario: A committed organization change leaves one audit intent in its outbox
      Given a Developer admitted to an organization
      When the admission commits
      Then organization's audit outbox holds one intent naming the admission
      And no audit row is written by organization

    @unit
    Scenario: Organization's audit intent records its audit fact
      Given an audit intent in organization's outbox
      When the outbox delivers it
      Then organization records the audit fact, keyed by the intent's audit id

    @unit
    Scenario: An organization audit fact delivered twice writes one audit row
      Given organization recorded an audit fact keyed by an audit id
      When audit-log's subscriber receives the fact twice
      Then one audit row is stored under that key, with organization's action and metadata

  Rule: Audit-log reacts to billing's audit facts (Alex, 2026-10-08, round 37 D3)
    Billing records each platform operator's billing command as an audit fact on its own lifecycle
    pipeline, and audit-log's peer subscriber writes the row main wrote: the operator, the action,
    its arguments and its target. Billing holds no audit-log peer and never writes the audit table.

    @unit
    Scenario: A billing audit fact delivered twice writes one audit row
      Given billing recorded a platform operator's command as an audit fact keyed by an audit id
      When audit-log's subscriber receives the fact twice
      Then one audit row is stored under that key, with billing's action, arguments and target
