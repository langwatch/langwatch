Feature: Upgrade modal when a call is refused by the licence
  As a member of an organization on a plan with limits
  I want any refused action to tell me which limit I hit and how to lift it
  So that I never see a raw error for a refusal the plan explains

  # The server throws a typed `LimitExceededError` (a seat or resource limit)
  # or the authz `lite_member_restricted` refusal. Both travel to the browser
  # on the serialised failure payload, and the licensing feature installs one
  # reader over every failed mutation — the same shape the model-provider
  # feature uses for `MODEL_NOT_CONFIGURED`. The reader opens the upgrade
  # modal, because a limit carries an upgrade action a toast has nowhere to
  # put, and marks the failure handled so no screen reports it a second time.

  Background:
    Given I am logged in
    And I have access to a project in an organization

  @integration
  Scenario: A refused call at a seat limit opens the upgrade modal
    Given the organization has reached its member limit
    When a call I make is refused for that limit
    Then the upgrade modal opens naming the limit and the usage
    And the refusal does not surface as a generic red error toast

  @integration
  Scenario: A refused call on a Lite Member seat opens the restriction modal
    Given I am on a Lite Member seat
    When a call I make is refused as restricted for that seat
    Then the upgrade modal opens in its restriction mode naming the resource
    And the refusal does not surface as a generic red error toast

  @integration
  Scenario: A refusal the licence does not explain is left to the screen
    Given a call fails for a reason unrelated to the licence
    When the licensing reader reads it
    Then it reports nothing, so the screen still can
