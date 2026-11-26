Feature: Analytics refuses a filter value it cannot apply
  As someone querying analytics over the REST API
  I want a filter value the query cannot apply to be refused
  So that I never read numbers that look filtered and are not

  The filter-options endpoint returns each option as a `field` (the value to
  send) and a `label` (the words to show). The boolean filters ("contains
  error", "has annotation", "evaluation passed") accept only "true" and
  "false". Sending a label used to leave the filter matching every row, so the
  answer came back identical to the unfiltered one. The same held for the
  metadata value and event metric value filters sent without their key.

  Selecting both "true" and "false" is every row on purpose, so it stays
  accepted.

  Rule: A boolean filter accepts only the values the options endpoint returns

    @unit
    Scenario: Filtering to traces that contain an error narrows the query
      Given a timeseries request filtering traces with an error
      When the query is built
      Then the query only counts traces that contain an error

    @unit
    Scenario: Asking for both error states filters nothing
      Given a timeseries request asking for traces with and without an error
      When the query is built
      Then the query counts every trace

    @unit
    Scenario: An option label sent as a boolean filter value is refused
      Given a timeseries request whose error filter carries "Traces with error"
      When the query is built
      Then it is refused with "analytics_filter_value_unsupported" naming the filter and the values it accepts

    @unit
    Scenario: The annotation and evaluation pass filters refuse a label the same way
      Given a timeseries request whose annotation or evaluation pass filter carries an option label
      When the query is built
      Then it is refused with "analytics_filter_value_unsupported"

  Rule: A filter that has nothing to match without its key is refused without one

    @unit
    Scenario: A metadata value filter sent without its metadata key is refused
      Given a timeseries request filtering on a metadata value as a plain list
      When the query is built
      Then it is refused with "analytics_filter_key_required" and an example of the nested shape

    @unit
    Scenario: An event metric value filter sent without its metric key is refused
      Given a timeseries request filtering on an event metric value keyed only by event type
      When the query is built
      Then it is refused with "analytics_filter_key_required"

    @unit
    Scenario: An evaluation pass filter without an evaluator still reads across every evaluator
      Given a timeseries request filtering evaluations that passed as a plain list
      When the query is built
      Then the query is built without a refusal

  Rule: The refusal happens at the analytics boundary, before any read

    @unit
    Scenario: The REST endpoint refuses a label before reading any table
      Given a project API key that may read analytics
      When a timeseries is requested with an error filter carrying an option label
      Then the response is a 422 with code "analytics_filter_value_unsupported"
      And no analytics table was read

    @unit
    Scenario: A series filter carrying a label is refused the same way
      Given a project API key that may read analytics
      When a timeseries is requested with a series whose own error filter carries an option label
      Then the response is a 422 with code "analytics_filter_value_unsupported"

    @unit
    Scenario: The legacy REST analytics path refuses the same value
      Given a project API key that may read analytics
      When a timeseries is requested on the legacy path with an error filter carrying an option label
      Then the response is a 422 with code "analytics_filter_value_unsupported"

    @unit
    Scenario: The values the filter options return are still served
      Given a project API key that may read analytics
      When a timeseries is requested with the error filter set to "true"
      Then the response is a 200 with the series

  Rule: A filtered query returns the filtered numbers

    @integration
    Scenario: The error filter narrows the count of seeded traces
      Given traces that contain an error and traces that do not
      When a timeseries query counts them unfiltered, filtered to "true" and filtered to "false"
      Then the filtered counts are the traces with and without an error and add up to the unfiltered count
