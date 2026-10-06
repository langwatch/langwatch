Feature: The identity and directory-sync ledgers compose from a Prisma client alone
  As a background worker process
  I want to build the identity and directory-sync pipelines for myself
  So that the graph consuming event-sourcing/jobs stops depending on the
  application that used to assemble it

  # WHY THIS EXISTS
  #
  # Identity's ledgers once reached the packaged worker as definitions the
  # platform application built and handed over. The identity module now
  # declares its own: the identity ledger (identifiers plus two-step
  # verification), the join-request ledger and the SSO connection ledger, each
  # handing its commands back to the module through ConnectedIdentityEventing.
  # The directory-sync ledger is SCIM's and is declared by that module.

  Rule: The identity module declares its own ledgers

    @unit
    Scenario: The identity module declares its identity, join-request and SSO connection ledgers itself
      Given a process that installs the identity module
      When it composes the module's eventing
      Then identity declares the identity, join-request and SSO connection ledgers
      And each hands its commands back to the module as the process connects it
      And the directory-sync ledger is not among them, because SCIM declares it

    @unit
    Scenario: The worker builds the identity ledger from its own client
      Given a worker process holding one Prisma client
      When it builds the identity pipeline
      Then the pipeline registers the same commands and folds the application registers
      And a folded user's identifier heads are written to that client
      And the projection cursor is written last, as the commit marker
      And the guards read the identifier heads off the same client
      # The cursor order is the whole recovery story: a crash before it leaves
      # rows a re-applied event overwrites idempotently, and a crash after it
      # is a completed apply.

    @unit
    Scenario: The worker builds the directory-sync ledger from its own client
      Given a worker process holding one Prisma client
      When it builds the directory-sync pipeline
      Then the pipeline registers the same commands and fold the application registers
      And it registers no process manager
      And a folded sync's state is written to that client
      # No process manager, deliberately: a SCIM push is a request an identity
      # provider makes and retries on its own schedule, so an unregistered
      # pipeline here loses writes rather than a sweep.

  Rule: One address lock serves the guards and the fold

    @unit
    Scenario: The address lock the guards claim through is the one the fold releases through
      Given a worker process holding one Prisma client
      When it composes the identity guards
      Then the composition hands back the address lock as well as the guards
      And the fold releases the locks a user no longer backs through it
      # The guards claim an address before stating a fact and the fold releases
      # it once no live identifier of that user still carries the value. A fold
      # composed without the lock writes every row correctly and never frees a
      # customer's address again.

  Rule: One ScimSyncState repository serves the fold and its guards

    @unit
    Scenario: One ScimSyncState repository serves the fold and its guards
      Given a worker process holding one Prisma client
      When it builds the directory-sync pipeline
      Then the guards' read runs over the same client the fold writes
      And a sync is resolved by its organization as well as its id
      # Two repositories would still compile and still route every key. What
      # they would eventually disagree about is `deadLetters` — the record of
      # what a directory was told it could stop retrying.

  Rule: The guards are composed over the process's own client

    @unit
    Scenario: The worker composes the identity guards from its own client
      Given a worker process holding one Prisma client
      When it composes the identity and two-step verification guards
      Then both read their state off that client
      # A guard over an empty stand-in refuses identically to a guard over a
      # real client with no rows, so the refusal alone proves nothing: which
      # client answered is the fact under test.
