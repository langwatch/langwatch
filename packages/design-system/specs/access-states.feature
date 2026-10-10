Feature: Consistent upgrade and access states
  Scenario: An Enterprise gate names the missing plan and offers a next step
    Given a feature requires Enterprise
    When its gate is shown
    Then the feature and required plan are named with one primary action

  Scenario: A reader can copy a permission request for their admin
    Given a reader lacks a permission
    When they copy an access request
    Then the request includes the permission and current page address
    And they are told to send it to an organization admin

  Scenario: A failed copy still explains how to ask for access
    Given clipboard access is unavailable
    When the reader copies an access request
    Then the page explains how to send the address and permission manually

  Scenario: A Lite member asks for access without a plan purchase
    Given a Lite member is refused an action
    When the access dialog opens
    Then it offers an access request and a way back without a purchase action
