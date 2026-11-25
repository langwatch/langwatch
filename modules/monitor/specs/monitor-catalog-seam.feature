Feature: The monitor listing ingestion reads composes without the evaluator graph
  The evaluation trigger asks, once per trace, which of a project's monitors are
  enabled to run on every message. That is the whole of its dependency on
  Monitor. Writing a monitor resolves the evaluator behind it and mints ids, so
  the write path reaches an evaluator and an id generator; the listing reaches
  neither, and is answered from the monitor rows alone.

  Rule: The catalogue answers from the repository and nothing else

    @unit
    Scenario: The monitor catalogue answers from the monitor rows alone
      Given a monitor repository and no evaluator
      When the catalogue is asked for a project's listing
      Then it lists that project's enabled on-message monitors

  Rule: One implementation, two callers

    @unit
    Scenario: The application and the catalogue answer from one implementation
      Given the monitor application and the catalogue over the same repository
      When both are asked for the same project's listing
      Then both answer identically
