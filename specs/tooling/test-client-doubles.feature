Feature: One typed double per raw client, in the test harness
  A raw client (Prisma, ClickHouse, ioredis, Stripe) is never cast into a test
  (ARCHITECTURE.md §13). `@langwatch/test-harness/client-doubles/<client>` builds
  the real client, never connected, and answers only what the test scripted, so
  a test that reaches a member nobody scripted fails naming it.

  Rule: a scripted member answers what the test scripted

    @unit
    Scenario: A scripted member answers what the test scripted
      Given a client double scripted with one member at any depth
      When the code under test calls that member
      Then it receives the scripted answer and the script records the call

  Rule: anything unscripted throws by name

    @unit
    Scenario: An unscripted method throws naming its path
      Given a client double scripted with nothing for that method
      When the code under test calls it
      Then it throws an error naming the member path, such as "prisma.project.findMany is not scripted"

    @unit
    Scenario: An unscripted namespace throws at the member the code calls
      Given a client double with no script for a nested namespace
      When the code under test calls a method inside that namespace
      Then it throws an error naming the full path to that method

    @unit
    Scenario: An unscripted property read throws naming its path
      Given a client double with no script for a plain property of the client
      When the code under test reads that property
      Then it throws an error naming the property path

  Rule: the double is the client's own type, with no cast

    @unit
    Scenario: A client double typechecks as the real client
      Given a client double built from a script
      When it is passed where the real client type is expected
      Then it typechecks without any cast

  Rule: a memory Redis double answers from its own store

    @unit
    Scenario: A memory Redis answers commands from its own store
      Given a memory Redis double and the connections duplicated from it
      When the code under test writes and reads keys, batches commands, or publishes
      Then each answers from one shared in-process store, and an unimplemented command throws naming it
