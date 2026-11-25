Feature: One summary card per directory push on LangWatch's sign-ups channel
  As a LangWatch team member watching the sign-ups channel
  I need to see when a customer's directory added, changed or removed people
  So that a large SCIM roll-out is visible without one message per person

  # SCIM has no push boundary: a directory sends one request per person. A push
  # is one organization's burst of requests that has gone quiet for three
  # minutes. Directories send a push's requests seconds apart and Entra's cycles
  # come about 40 minutes apart, so three minutes ends a push without merging two.
  # Entra re-sends everyone each cycle; a request that restates what we already
  # hold is not a change and is never counted.

  Background:
    Given an organization "Acme" whose directory is connected over SCIM

  @unit
  Scenario: A quiet push posts one card with its counts
    Given the directory added "Ada Lovelace", updated one person and deactivated one person
    And one apply failed
    When three minutes pass with no further request from the directory
    Then one summary card is posted for "Acme"
    And it counts 1 added, 1 updated, 1 deactivated and 1 failed
    And it names "Ada Lovelace" among the people added

  @unit
  Scenario: A restated person is not a change
    Given the directory re-sends a person exactly as we already hold them
    Then the push records that nothing changed
    And no summary card is posted

  @unit
  Scenario: A changed name is a change
    Given the directory sends a person under a new name
    Then the push records a change

  @unit
  Scenario: A burst still going is not posted yet
    Given the directory added a person
    And another request arrives two minutes later
    When the wake meant for the first request comes
    Then no summary card is posted yet
    And the card waits for three quiet minutes after the last request

  @unit
  Scenario: A push is posted once even when woken twice
    Given a push's summary card was posted
    When the process wakes again
    Then no second card is posted

  @unit
  Scenario: Without the sign-ups webhook the summary is skipped with a warning
    Given SLACK_CHANNEL_SIGNUPS is not configured
    When a push's summary is posted
    Then nothing is sent
    And a warning says the summary was skipped

  @unit
  Scenario: A Slack failure is logged and never thrown
    Given Slack refuses the summary card
    When a push's summary is posted
    Then the failure is logged
    And the post completes without an error

  @unit
  Scenario: A burst that never goes quiet is posted after 30 minutes
    Given the directory keeps sending changes at least once a minute for 30 minutes
    When the burst reaches 30 minutes
    Then one summary card is posted for what came so far
    And the next request starts a fresh burst
