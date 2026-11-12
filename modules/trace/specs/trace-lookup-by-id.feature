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
  Scenario: A trace in another project the key may not read names that project
    Given the trace is stored in another project of the same organisation
    And the key's owner may read that project but the key may not
    When I get the trace by its id
    Then the answer is a trace_in_other_project error
    And it names the project slug and the command to read it from there

  @unit
  Scenario: A trace in a project the key's owner cannot read stays hidden
    Given the trace is stored in a project the key's owner cannot read
    When I get the trace by its id
    Then the answer is trace_not_found
    And it does not name that project

  @unit
  Scenario: A fresh trace_not_found is retryable, not terminal
    When I get an id no project holds yet
    Then the answer is trace_not_found marked retryable
    And the CLI error document does not mark it terminal

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
