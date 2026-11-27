Feature: Looking up a trace by id never fails for a trace that exists
  `langwatch trace get <id>` and `GET /api/v1/traces/{id}` are how people and
  agents load evidence. A trace that exists must load, or the answer must say
  exactly where it is and what to run next. A bare "not found" for an id that
  exists sends an agent off diagnosing from nothing.

  Background:
    Given I hold an API key for a project

  @integration
  Scenario: A trace whose spans are stored but whose summary is not yet written still loads
    Given a trace whose spans are stored
    And its summary row has not been written yet
    When I get the trace by its id
    Then the trace comes back built from its stored spans
    And the answer says the trace is still being stored

  @unit
  Scenario: A trace in another project the key may read is served from that project
    Given the trace is stored in another project of the same organisation
    And the key may read that project
    When I get the trace by its id
    Then the trace comes back
    And the answer names the project it was found in

  @unit
  Scenario: A trace in a project the key may not read stays hidden
    Given the trace is stored in another project of the same organisation
    And the key may not read that project, even when the key's owner may
    When I get the trace by its id
    Then the answer is trace_not_found
    And neither the answer nor what it says was searched names that project

  @unit
  Scenario: A fresh trace_not_found is retryable, not terminal
    When I get an id no project holds yet
    Then the answer is trace_not_found marked retryable
    And the CLI error document does not mark it terminal

  @unit
  Scenario: A trace_not_found names only the id kinds the lookup tried
    When I get an id no project holds yet
    Then the answer lists the trace id and the stored spans as searched
    And it lists a prefix, a span id or a scenario run id only when the id is shaped like one

  @unit
  Scenario: The CLI retries a trace that is still arriving
    Given the first lookups answer trace_not_found marked retryable
    When I run `langwatch trace get <id>`
    Then the CLI retries briefly before reporting
    And it prints the trace once it arrives

  @unit
  Scenario: An uppercase or padded trace id is normalised
    Given a trace exists with a lowercase hex id
    When I get it by the same id in uppercase with surrounding spaces
    Then the trace comes back

  @integration
  Scenario: A span id resolves to the trace that holds it
    Given a trace holds a span with a known span id
    When I get the trace by that span id
    Then the trace that holds the span comes back
    And the answer says it was resolved from a span id

  @integration
  Scenario: A scenario run id resolves to the trace it produced
    Given a trace carries the attribute scenario.run_id
    When I get the trace by that scenario run id
    Then the trace comes back
    And the answer says it was resolved from a scenario run id

  @unit
  Scenario: A scenario run with several traces lists them
    Given a scenario run produced several traces
    When I get the trace by that scenario run id
    Then the answer is a scenario_run_has_many_traces error listing every trace id

  @integration
  Scenario: A trace whose summary sits in the epoch partition still loads
    Given a trace whose summary row carries OccurredAt 0
    When I get the trace by its id
    Then the trace comes back with its spans

  @integration
  Scenario: A trace older than the platform default retention still loads on a longer policy
    Given a trace stored 200 days ago in a project that keeps traces for a year
    When I get the trace by its id
    Then the trace comes back with its spans

  @unit
  Scenario: The CLI and the REST route answer the same for one id
    When I get a trace with `langwatch trace get <id> --format json`
    Then the CLI prints the REST route's document for that id

  @unit
  Scenario: A miss reads only what the id can be
    Given no trace in the project holds the id
    When I get a trace by a full trace id
    Then the read checks the summaries once and the stored spans once
    And no span id scan runs, since the id is not shaped like a span id
    And a span id scan runs only for an OTel span id or an SDK span id, since the retention floor

  @integration
  Scenario: A miss checks every readable project in one read per table
    Given the key's organisation has many projects and none holds the trace
    When the by-id read looks for the trace in the other projects
    Then it reads each table once over the whole project set
    And a trace id the id index has never seen reads no source rows
