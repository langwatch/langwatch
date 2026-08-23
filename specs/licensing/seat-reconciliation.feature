Feature: Reconciling an organization down to its licensed seats

  A self-hosted deployment runs uncapped without a license, so by the time an
  organization buys one it can easily have more members than the seats it just
  paid for. Activating the license must not silently accept that (the seats are
  what is being billed) and must not lock the company out either.

  So activation always succeeds, and the organization lands in an over-seats
  state: every existing member keeps working, and an admin is asked to choose
  who to disable until the active count is within the license. Only new members
  are refused while that is pending, because letting the org grow further is the
  one thing that makes the overage worse.

  Disabling is per organization and reversible. The membership keeps its role,
  its department and everything the person did; they simply lose access and
  their seat is returned to the pool. When a seat frees up later, an admin
  re-enables them and nothing has to be rebuilt.

  As an admin of a self-hosted organization that has just bought a license
  I want to choose who keeps a seat
  So that activating a license never locks my company out and never bills me
  for people I removed

  Background:
    Given a self-hosted deployment
    And an organization "org-123" with 25 active members

  @integration
  Scenario: Activating a license for fewer seats than the org has succeeds
    When an admin activates a license for 10 members
    Then the license is stored and active
    And all 25 members can still sign in

  @integration
  Scenario: The organization is told how many seats it has to give back
    Given the organization has activated a license for 10 members
    When an admin opens the license page
    Then the organization is shown as over its seat count
    And it is told that 15 members have to be disabled

  @integration
  Scenario: Inviting another member is refused while over the seat count
    Given the organization has activated a license for 10 members
    When an admin invites another member
    Then the invitation is refused for exceeding the licensed seats

  @integration
  Scenario: Disabling a member returns their seat
    Given the organization has activated a license for 10 members
    When an admin disables 15 members
    Then the organization is within its seat count
    And inviting another member is refused again only once 10 seats are in use

  @integration
  Scenario: A disabled member loses access but keeps their record
    Given a member of the organization has been disabled
    Then they cannot act in that organization
    But their role and department assignment are unchanged
    And the work they did is still attributed to them

  @integration
  Scenario: A disabled member cannot act through any permission path
    Given a member of the organization has been disabled
    When they try to act in that organization
    Then the request is refused
    And they are told their access was disabled, not that they are not a member

  @unit
  Scenario: A disabled member's API keys stop working
    Given a member of the organization has been disabled
    When a request arrives on an API key they own
    Then the request is refused
    But a service key that belongs to nobody keeps working

  @unit
  Scenario: A link that was public to anyone still opens for a disabled member
    Given a member of the organization has been disabled
    When they open a link that was shared with anyone
    Then the link still opens
    But a link shared only with the organization does not

  @unit
  Scenario: Disabling takes effect at once, not when a cache expires
    When an admin disables or re-enables a membership
    Then every authorization answer held for that organization is retired immediately

  @integration
  Scenario: A disabled member can be re-enabled when a seat is free
    Given the organization is within its seat count
    And a member of the organization has been disabled
    When an admin re-enables that member
    Then they can act in the organization again

  @integration
  Scenario: Re-enabling a member is refused when it would exceed the seats
    Given the organization has every licensed seat in use
    And a member of the organization has been disabled
    When an admin re-enables that member
    Then the request is refused for exceeding the licensed seats

  @integration
  Scenario: Disabled members are not counted against the license
    Given an organization with 25 members of whom 15 are disabled
    When the seat usage is counted
    Then 10 members are counted

  @integration
  Scenario: Disabling the last admin is refused
    Given the organization has one active admin
    When an admin disables that membership
    Then the request is refused so the organization keeps an admin who can sign in

  @integration
  Scenario: Demoting the last admin is refused
    Given the organization has one admin
    When their role is changed to member
    Then the request is refused so the organization keeps an admin who can sign in

  @integration
  Scenario: An organization within its seats is not told anything
    Given the organization has as many members as its license covers
    When an admin opens the license page
    Then no seat warning is shown

  # ============================================================================
  # Choosing who keeps a seat, without guessing
  # ============================================================================
  #
  # Reconciling means walking the member list and deciding person by person, and
  # the two decisions available there are moving someone to a Lite Member seat
  # and disabling them outright. Each has its own allowance and each is refused
  # once that allowance runs out, so an admin who cannot see the allowances
  # learns them one refusal at a time. The member list carries the same seat
  # counts the license page does, and a refusal names the allowance that ran out
  # rather than reporting that the action could not be completed.

  @integration
  Scenario: The member list shows how many seats of each kind are in use
    When an admin opens the member list
    Then the full member seats in use are shown against what the license covers
    And the Lite Member seats in use are shown the same way

  @integration
  Scenario: Running out of Lite Member seats names that allowance
    Given the organization has every Lite Member seat in use
    When an admin moves another member to a Lite Member seat
    Then the request is refused for exceeding the Lite Member seats
    And the refusal offers disabling a membership as the reversible alternative
