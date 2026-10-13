Feature: A failed turn of the guided onboarding conversation reaches PostHog through nurturing

  Langy records the failure as a fact on its own pipeline and holds no analytics
  channel (CLAUDE.md rule 7). Nurturing reacts as a peer subscriber and sends
  guided_onboarding_turn_failed against the conversation's user, as main sent it.
  Customer.io is told nothing of it.

  @unit
  Scenario: A failed guided turn langy recorded is tracked against the conversation's user
    Given langy recorded a failed turn of the organization's guided conversation on the gateway path
    When nurturing handles the fact
    Then PostHog tracks "guided_onboarding_turn_failed" against the user of the conversation
    And it carries the code, the path, the conversation, the turn, the organization, the project and the experiment property
    And Customer.io is told nothing

  @unit
  Scenario: A failed guided turn of an organization without a variant carries no experiment property
    Given langy recorded a failed turn for an organization older than the onboarding experiment
    When nurturing handles the fact
    Then PostHog tracks "guided_onboarding_turn_failed" without the experiment property

  @unit
  Scenario: A redelivered failed-turn fact is tracked once
    Given langy recorded a failed turn of the guided conversation
    When nurturing handles the same fact twice
    Then PostHog tracks "guided_onboarding_turn_failed" once
    And the event carries one uuid for every delivery of that source event
