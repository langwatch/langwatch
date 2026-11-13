Feature: Ops agent access pages
  The operator's pages for agent access: /ops/agents to enrol agents, watch sessions and revoke
  them, and /ops/agents/approve/:requestId to approve one request with a passkey. ADR-202.

  Background:
    Given cloud ops is on and the system flag "ops_agent_access_enabled" is on
    And Olivia holds the platform-operator grant and has a passkey

  @integration
  Scenario: The agents page reads as not found while the feature is off
    Given the flag "ops_agent_access_enabled" is off
    When Olivia opens "/ops/agents"
    Then she sees a not found page and no agent controls

  @integration
  Scenario: An operator without a passkey is sent to add one before enrolling
    Given Pedro holds the platform-operator grant and has no passkey
    When Pedro opens "/ops/agents"
    Then he reads "Add a passkey before you enrol an agent" with a link to "/settings/security"
    And no "Enrol an agent" button is offered

  @integration
  Scenario: Enrolling an agent shows its requester key and setup command once
    When Olivia enrols "desk agent" and confirms with her passkey
    Then the requester key starting "lwsr_" is shown with a copy button
    And the command "langwatch ops setup --requester-key <key>" is shown
    And the new agent is listed under her agents

  @integration
  Scenario: A cancelled passkey prompt enrols nothing
    When Olivia enrols "desk agent" and closes the passkey prompt
    Then she reads that the passkey check did not finish
    And no enrolment is sent

  @integration
  Scenario: The kill switch needs the typed confirmation
    When Olivia asks to revoke all agent access and types "revoke everything"
    Then nothing is revoked and she is asked to type "revoke all" exactly
    And when she types "revoke all" every live session is revoked and the count is shown

  @integration
  Scenario: An operator revokes a live session from the agents page
    Given a live session on "ACME"
    When Olivia revokes it and confirms
    Then the session reads as revoked

  @integration
  Scenario: The approval page shows the request with the reason as plain text
    Given a pending request whose reason holds markup
    When Olivia opens its approval page
    Then she sees the organization name and id, each scope with its plain line, the machine, the request IP and a countdown
    And the reason shows exactly as typed, with no markup rendered

  @integration
  Scenario: A request the operator may not open reads as not found
    Given the request belongs to another operator's agent
    When Olivia opens its approval page
    Then she sees "Request not found" and no approve button

  @integration
  Scenario: Content access asks for the organization name before the passkey
    Given a pending request for "org:content" on "ACME"
    When Olivia approves without typing the organization name
    Then she is asked to type it and no passkey ceremony starts
    And a content warning is shown
    And when she types "ACME" the ceremony runs with the typed name

  @integration
  Scenario: Spend is off by default and ticking it asks for the organization name
    Given a pending request for "org:support" on "ACME"
    Then the spend tick is off and no organization name is asked for
    When Olivia ticks spend
    Then the organization name is asked for
    And the approval is signed with spend on

  @integration
  Scenario: A refused passkey is shown plainly with a retry
    Given a pending request
    When the server refuses the passkey assertion
    Then Olivia reads why it was refused and can try again
    And the request stays pending

  @integration
  Scenario: A decided or expired request shows its outcome and offers no approval
    Given a request that expired, was approved or was denied
    When Olivia opens its approval page
    Then she reads its outcome and no approve button is offered
