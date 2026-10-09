Feature: Event detail mapping when adding traces to a dataset
  As a user mapping trace data into a dataset
  I want to map one detail of an event, such as the feedback text
  So that the column holds that value rather than the whole event

  # Tracked events store their details as `event.details.<name>`. The mapping
  # offers and resolves them as `event_details.<name>`.

  @unit
  Scenario: Mapping an event detail by its plain name
    Given a trace with a thumbs_up_down event whose feedback is "too slow"
    When a column maps source "events", key "thumbs_up_down", subkey "event_details.feedback"
    Then the column holds "too slow"

  @unit
  Scenario: Event detail subkeys are offered by their plain name
    Given a trace with a thumbs_up_down event whose feedback is "too slow"
    When the events source lists the subkeys for "thumbs_up_down"
    Then "event_details.feedback" is offered
