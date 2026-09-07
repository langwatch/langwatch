Feature: Analytics rejects filter values it cannot apply
  As someone querying analytics over the REST API
  I want a filter value the platform cannot apply to be refused
  So that I never read numbers that look filtered and are not

  Every analytics filter field has a closed set of values it accepts. The
  boolean ones ("does the trace contain an error", "does the trace have an
  annotation", "did the evaluation pass") accept only "true" and "false".
  The list-options endpoint returns each option twice over: a `field` (the
  value to send) and a `label` (the words to show). Sending the label instead
  of the field used to leave the filter matching every row, so the answer came
  back identical to the unfiltered one with nothing to say it had been
  dropped. Wrong numbers that look right are worse than an error.

  Selecting both "true" and "false" is not the same mistake: it is every row
  on purpose, which is what the user asked for, so it stays a no-op.

  Background:
    Given a project with analytics data

  Rule: A boolean filter accepts only the values the options endpoint returns

    @unit
    Scenario: Filtering to traces that contain an error narrows the query
      Given a timeseries request filtering traces with an error
      When the query is built
      Then the query only counts traces that contain an error

    @unit
    Scenario: Filtering to traces without an error narrows the query
      Given a timeseries request filtering traces without an error
      When the query is built
      Then the query only counts traces that contain no error

    @unit
    Scenario: Asking for both error states filters nothing
      Given a timeseries request asking for traces with and without an error
      When the query is built
      Then the query counts every trace

    @unit
    Scenario: A filter value the field does not accept is refused
      Given a timeseries request whose error filter carries an option label instead of its value
      When the query is built
      Then the request is refused as a validation error naming the filter and the values it accepts

    @unit
    Scenario: The annotation filter refuses a value it cannot apply
      Given a timeseries request whose annotation filter carries an option label instead of its value
      When the query is built
      Then the request is refused as a validation error naming the filter and the values it accepts

    @unit
    Scenario: The evaluation pass filter refuses a value it cannot apply
      Given a timeseries request whose evaluation pass filter carries an option label instead of its value
      When the query is built
      Then the request is refused as a validation error naming the filter and the values it accepts

  Rule: A filter that needs a key is refused without one

    @unit
    Scenario: A metadata value filter sent without its metadata key is refused
      Given a timeseries request filtering on a metadata value with no metadata key
      When the query is built
      Then the request is refused as a validation error naming the filter and the key it needs

    @unit
    Scenario: An event metric value filter sent without its metric key is refused
      Given a timeseries request filtering on an event metric value with no metric key
      When the query is built
      Then the request is refused as a validation error naming the filter and the key it needs

  Rule: The REST analytics endpoints apply the filters they are given

    @integration
    Scenario: A filtered timeseries query returns fewer traces than an unfiltered one
      Given traces that contain an error and traces that do not
      When a timeseries query is run with no filters
      And the same query is run filtered to traces that contain an error
      Then the filtered query counts only the traces that contain an error

    @integration
    Scenario: The REST endpoint refuses a filter value it cannot apply
      Given a project API key that may read analytics
      When a timeseries is requested with an error filter carrying an option label
      Then the response is a validation error naming the filter

    @integration
    Scenario: The legacy REST analytics path refuses the same value
      Given a project API key that may read analytics
      When a timeseries is requested on the legacy path with an error filter carrying an option label
      Then the response is a validation error naming the filter
