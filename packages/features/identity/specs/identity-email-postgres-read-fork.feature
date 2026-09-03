Feature: The identifier email read fork composes from a Prisma client alone
  As a process that resolves browser sessions
  I want to answer "which address is this person's" from the identifiers
  So that a finalized user's stale User.email column stops being the answer

  # WHY THIS EXISTS
  #
  # `IdentityEmailService` has lived in `@langwatch/identity-server` since
  # ADR-101 §5, but nothing outside the platform application could construct
  # one: its two collaborators — the `Identifier` projection reads and the
  # per-user latch — had exactly one implementation each, and both were the
  # application's. That is what put "IdentityEmailService" on
  # `API_UNAVAILABLE_PRODUCT_ADAPTERS`.
  #
  # Read one operation at a time, all of it is Postgres. The heads are a
  # `findMany` over `Identifier` plus one `User.userHashKey` lookup; the latch
  # is two reads of the `SystemMigrationTenantState` row the D01 backfill
  # writes. `PostgresIdentityEmailAdapter` is both, over one guarded client.
  #
  # The latch is CACHED, and the cache is part of the behaviour rather than an
  # optimization: the fork is asked on every request that resolves a session,
  # so an uncached composition would put a lookup per request per active user
  # on the session path — and before anybody is enrolled it would spend all of
  # them learning what a single row already settles.

  Rule: The identifiers answer only for a user whose backfill has finalized

    @unit
    Scenario: A finalized user's primary identifier answers for the column
      Given the deployment has enrolled a user and their backfill finalized
      And that user holds a PRIMARY email identifier
      When the process resolves the user's email
      Then it answers the identifier's address

    @unit
    Scenario: A user nobody has enrolled keeps the legacy column
      Given no user in the deployment has finalized the identifier backfill
      When the process resolves a user's email
      Then it answers nothing, so the caller keeps User.email
      And it never reads the identifier projection
      # The fleet-wide question is asked first precisely so the per-user read
      # and the projection read are not spent on a deployment where no answer
      # could exist.

    @unit
    Scenario: A held user keeps the legacy column
      Given a user whose backfill state is migrated rather than finalized
      When the process resolves the user's email
      Then it answers nothing, so the caller keeps User.email
      # `migrated` means the history landed and the proof did not agree. Only
      # `finalized` forks the reads, the same one switch that forks the writes.

    @unit
    Scenario: Every proven address is offered for invitation matching
      Given a finalized user holding one PRIMARY and one VERIFIED identifier
      When the process lists the addresses that user has proven
      Then both are offered, and an unproven ATTACHED one is not

  Rule: Nothing on this path may fail a request

    @unit
    Scenario: An unreadable latch keeps the legacy column and says so
      Given the migration-state table cannot be read
      When the process resolves a user's email
      Then it answers nothing, so the caller keeps User.email
      And the failed read is logged rather than swallowed
      # A latch closed because the table is unreadable and a latch closed
      # because nobody is enrolled look identical from the outside, which is
      # how a real outage reads as routine.

    @unit
    Scenario: A projection row this build cannot parse keeps the legacy column
      Given a finalized user holding an identifier in a state this build does not know
      When the process resolves the user's email
      Then it answers nothing, so the caller keeps User.email
      # Guessing at the state would answer a question about somebody's live
      # sign-in with a value nobody wrote.

  Rule: The latch is read once per process per window

    @unit
    Scenario: A second resolution inside the window reads nothing further
      Given the process has already resolved one user's latch
      When it resolves the same user again inside the cache window
      Then the migration-state table is not read again

    @unit
    Scenario: The answer is re-read once the window closes
      Given the process cached a user's latch answer
      When the cache window elapses and the user is resolved again
      Then the migration-state table is read again
      # Both directions take effect on this bound: there is no cross-process
      # invalidation, so an enrolment and a rollback are equally delayed.

    @unit
    Scenario: Concurrent resolutions of one cold user share a single read
      Given nothing is cached for a user
      When two resolutions for that user run concurrently
      Then the migration-state table is read once
      # Without coalescing, a burst against an uncached user is the stampede a
      # cache exists to prevent, deferred to the first request after expiry.

    @unit
    Scenario: The per-user cache is bounded
      Given more distinct users are resolved than the cache holds
      When another user is resolved
      Then the cache stays within its cap
      # Cardinality here is active users, so an entry nothing revisits would
      # otherwise sit in the map for the life of the process.

  Rule: The stored migration key is one string across both tiers

    @unit
    Scenario: The latch reads the D01 backfill's stored record
      Given the platform application registers the identifier backfill under its name
      When this package reads a user's latch
      Then it reads the record under the same name
      # A disagreement is silent: both tiers would simply answer "nobody is
      # latched", and the read fork would never turn on anywhere.
