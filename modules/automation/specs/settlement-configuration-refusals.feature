Feature: A settlement refused by the automation's own saved configuration

  A trace automation dispatches each confirmed match at settlement. Some
  dispatches cannot succeed however often they run, because the automation's
  saved configuration is the cause: an email action whose stored recipients
  no longer validate, a webhook action whose stored settings no longer parse,
  or a dataset action whose dataset is gone (its refusal is specified in
  dataset-action-stale-columns.feature). Those are the customer's to fix,
  so the refusal names a stable code with customer fault, ends the dispatch
  instead of retrying it, and is logged once as a warning rather than paging
  as an error. A failure we cannot name is still reported, once.

  Background:
    Given a trace automation with a confirmed match ready to dispatch

  @unit
  Scenario: An email automation whose saved recipients no longer validate is refused as the customer's to fix
    Given the automation sends an email to stored recipients that no longer validate
    When the match settles
    Then the refusal carries the code "invalid_action_params" with customer fault
    And the dispatch completes instead of retrying
    And one warning is logged and no error is reported

  @unit
  Scenario: An automation that keeps firing with an invalid saved configuration warns once per window
    Given the automation sends an email to stored recipients that no longer validate
    When several matches settle inside one hour
    Then every dispatch completes instead of retrying
    And one warning is logged for the automation and no error is reported

  @unit
  Scenario: A webhook automation whose saved settings no longer parse is refused as the customer's to fix
    Given the automation calls a webhook whose stored settings no longer parse
    When the match settles
    Then the refusal carries the code "invalid_action_params" with customer fault
    And the dispatch completes instead of retrying

  @unit
  Scenario: A persist refusal the customer must fix is warned once and not retried
    Given the automation's persist action is refused as the customer's to fix
    When the persist page settles
    Then the page completes instead of retrying
    And one warning is logged and no error is reported

  @unit
  Scenario: A rate-limited refusal is retried rather than treated as the customer's to fix
    Given the automation's persist action is refused with a rate limit
    When the persist page settles
    Then the page is retried
    And no configuration refusal is logged

  @unit
  Scenario: A dispatch failure we cannot name is reported once and retried
    Given the dispatch fails with an error that names no cause
    When the match settles
    Then the failure is reported exactly once
    And the dispatch is retried
