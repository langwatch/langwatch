Feature: The identity and directory-sync ledgers compose from a Prisma client alone
  As a background worker process
  I want to build the identity and directory-sync pipelines for myself
  So that the graph consuming event-sourcing/jobs stops depending on the
  application that used to assemble it

  # WHY THIS EXISTS
  #
  # Four identity pipelines run on the shared `event-sourcing/jobs` queue:
  # identity (D01 identifiers plus D06 two-step verification on the same
  # aggregate), sso-connections, scim-sync and join-requests. Until now all
  # four reached the packaged worker as DEFINITIONS the platform application
  # built and handed over, because every projection store and guard
  # repository lived in `platform/app/src/server/app-layer/identity`.
  #
  # Two of the four need nothing else. Read one dependency at a time, the
  # identity ledger is the `Identifier` head and its cursor, the
  # `MfaEnrollment` head, the address lock, and the legacy `User` columns the
  # cross-population collision guard consults — all Postgres. The
  # directory-sync ledger is one `ScimSyncState` row serving both the fold and
  # its guards. So both compose from a typed Prisma client and nothing else.
  #
  # The other two do not, and are deliberately out of scope here: the
  # connection ledger's teardown port revokes a torn-down connection's
  # directory tokens through the SCIM service, and the join ledger's lifecycle
  # port sends the reminder and the expiry notice through the mailer. Neither
  # the directory service nor an outbound mail gateway is something this
  # process can compose today.

  Rule: The worker builds the two Postgres-only ledgers itself

    @unit
    Scenario: The worker mounts the identity and directory-sync ledgers itself
      Given a worker process holding one Prisma client
      When it composes its durable graph
      Then it mounts the identity ledger and the directory-sync ledger
      And it mounts the connection and join ledgers only when the application hands them over
      # A graph carrying a proper subset of the four routes a proper subset of
      # their keys, and an unroutable job on this queue is redelivered forever
      # rather than dropped. That is why the composition that claims the queue
      # is the one that mounts every pipeline, and why a partial graph asks
      # for no consumers at all.

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
