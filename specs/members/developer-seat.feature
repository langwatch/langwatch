---
---
@integration
Feature: Developer seat
  As an organisation administrator
  I want a Developer seat that gives a person their own project and nothing shared
  So that developers can send traces today without using a capped seat

  # Design record: dev/docs/adr/143-developer-seat.md (Accepted).
  # A Developer owns a personal project, may act inside it (CLI, queries,
  # evaluations), never sees a shared project, is counted but never capped,
  # and may be downgraded from a Full seat. One organisation setting decides
  # which seat self-service and SSO joiners receive.

  Background:
    Given an organisation with one shared team and one shared project

  # ============================================================================
  # Admission
  # ============================================================================

  Scenario: An administrator invites a Developer while the plan is at its seat cap
    Given the organisation has no Full or Light seats left on its plan
    When an administrator invites a person with the seat "Developer"
    Then the invitation is created
    And after the person accepts they hold access to their personal team only

  Scenario: The joiner seat setting is Full by default
    Given the organisation admits people who sign in with a company email
    And the organisation has not changed its joiner seat
    When a person joins with a matching company email
    Then they are admitted as a Full member
    And they hold the organisation-wide access a Full member holds today

  Scenario: The joiner seat setting lands email joiners as Developers
    Given the organisation's joiner seat is set to "Developer"
    When a person joins with a matching company email
    Then they are admitted as a Developer
    And they hold access to their personal team only

  Scenario: The joiner seat setting lands SSO joiners as Developers
    Given the organisation's joiner seat is set to "Developer"
    When a person is admitted through single sign-on for the first time
    Then they are admitted as a Developer
    And they hold access to their personal team only

  Scenario: The joiner seat setting never applies to invitations
    Given the organisation's joiner seat is set to "Developer"
    When an administrator invites a person with the seat "Full"
    Then after the person accepts they are a Full member

  # ============================================================================
  # What a Developer can and cannot reach
  # ============================================================================

  Scenario: A Developer never sees a shared project
    Given a Developer in the organisation
    When the Developer asks for the list of projects they can open
    Then the list contains only their personal project
    And a request to view traces in the shared project is refused

  Scenario: A Developer works inside their own project
    Given a Developer with a personal project
    When they log in through the CLI and send a trace
    Then the trace is stored in the personal project
    And they can query and evaluate it there

  Scenario: CLI login refuses a shared project for a Developer
    Given a Developer logging in through the CLI
    When they pick a project that is not their personal project
    Then the login is refused with a message naming the Developer seat

  Scenario: A Developer cannot be given a role on a shared team
    Given a Developer in the organisation
    When an administrator tries to give them a role on the shared team
    Then the request is refused with a message naming the Developer seat
    And the Developer still holds access to their personal team only

  # ============================================================================
  # Downgrade
  # ============================================================================

  Scenario: Downgrading a Full member to Developer removes shared access
    Given a Full member with a role on the shared team
    And the organisation-wide access a Full member holds
    When an administrator changes their seat to "Developer"
    Then their shared team access is removed
    And their organisation-wide access is removed
    And each removal is written to the audit log
    And their personal project and its traces still exist
    And a request to view traces in the shared project is refused

  Scenario: A key on a shared project stops working after downgrade
    Given a Full member who owns a key scoped to the shared project
    And the same member owns a key scoped to their personal project
    When an administrator changes their seat to "Developer"
    Then a request with the shared-project key is refused
    And a request with the personal-project key succeeds

  # ============================================================================
  # Counting
  # ============================================================================

  Scenario: Developers are counted and never capped
    Given a plan that allows 5 Full seats and 5 Light seats, all in use
    When ten Developers are added
    Then all ten are admitted
    And the plan page shows 5 Full, 5 Light and 10 Developer seats
    And the Full and Light counts did not change

  # ============================================================================
  # Directory sync
  # ============================================================================

  Scenario: Directory sync leaves a Developer alone
    Given a Developer in an organisation synced from a customer directory
    When a sync arrives that places the person in an ordinary member group
    Then the person is still a Developer

  Scenario: Directory sync can still promote a Developer to administrator
    Given a Developer in an organisation synced from a customer directory
    When a sync arrives that places the person in an administrator group
    Then the person becomes an administrator

  # ============================================================================
  # Public API
  # ============================================================================

  Scenario: The management API accepts the Developer seat
    Given an organisation administrator using the management REST API
    When they create an invitation with the seat "Developer"
    Then the invitation is created
    And the API documentation lists "Developer" as a seat
