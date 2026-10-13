Feature: Composing the AuthZ grants ledger in a background worker

  The grants ledger has two halves and only one of them needs an application.
  The PRODUCER half is the request path: the contract services, the Redis
  epoch, the cutover gate and the dispatcher a writer resolves its sender
  from. The CONSUMER half is the pipeline — the read model's guarded writer
  and the insert-only audit trail — and it takes two Postgres bindings and
  nothing else.

  That is what lets the process that consumes `event-sourcing/jobs` build the
  ledger for itself rather than being handed a definition another process
  assembled. What must not move in the process is the expansion: one grant
  event writes the authoritative head AND the legacy heads the legacy
  resolver, the settings screens and the revoke-by-filter path still read.

  @unit
  Scenario: The worker mounts the grants ledger itself
    Given a background worker composing its own graph
    When it composes without being handed an AuthZ capability
    Then it still mounts the grants ledger
    And the ledger registers the pipeline the application registers

  @unit
  Scenario: The worker builds the grants ledger from its own client
    Given a worker holding one Prisma client
    When the ledger's read-model write is applied
    Then it is written through that same client
    And the routing keys it registers are the ones the queue already carries

  @unit
  Scenario: One grant's commands ride one ordered lane
    Given a composed grants ledger
    When its command lane options are read
    Then every command about one grant shares that grant's lane
    And the role commands keep their own

  @unit
  Scenario: One grant event expands onto both heads through one client
    Given a composed grants ledger
    When a grant is attached
    Then the authoritative row is written behind its own guard
    And the legacy binding the resolver reads is written with it

  @unit
  Scenario: A redelivered older attach never resurrects a revoked binding
    Given a grant that has already been revoked
    When an older attach for it is redelivered
    Then the authoritative row keeps its revocation
    And the legacy binding is removed rather than re-created

  @unit
  Scenario: The worker writes the grants audit trail through the same client
    Given a composed grants ledger
    When a grant revocation is audited
    Then the audit row is inserted through that client
    And a redelivery of the same event writes nothing new
