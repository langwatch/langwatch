Feature: The monitor listing ingestion reads composes without the evaluator graph
  The evaluation trigger asks, once per trace, which of a project's monitors are
  enabled to run on every message. That is the whole of its dependency on
  Monitor. The monitor service requires an evaluator service and an id generator
  because creating, updating and replicating a monitor resolves the evaluator
  behind it and mints ids, and a process that only wanted the listing had to be
  able to build all of it.

  Rule: The catalogue composes from a database and nothing else

    @unit
    Scenario: The monitor catalogue composes from a database alone
      Given a Prisma client and no evaluator service
      When the monitor catalogue is composed
      Then it lists a project's enabled on-message monitors

  Rule: One implementation, two composition roots

    @unit
    Scenario: The wide service and the catalogue answer from one implementation
      Given the monitor service and the catalogue over the same client
      When both are asked for the same project's listing
      Then both answer identically and read the same rows
