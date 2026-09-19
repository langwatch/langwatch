Feature: License sync
  A connected install reports its seat counts to LangWatch once a day and
  receives a signed lease in return. The lease carries what the license is
  entitled to and how many seats it may go over by, and it expires. When sync
  stops, the lease runs out and the install falls back to the plain licensed
  seat count on its own. There is no timestamp on the install to edit.

  The sync carries metadata only. Product statistics are a separate, optional
  post with its own switch. An air-gapped install sends neither.

  As a LangWatch customer running a connected install
  I want seat changes and license renewals to flow through one outbound call
  So that I am never blocked from adding a colleague and never emailed a key again

  Background:
    Given a self-hosted install with Connect enabled
    And an organization with a valid license for 50 seats that LangWatch has registered

  # ============================================================================
  # What is sent, and what is not
  # ============================================================================

  @unit
  Scenario: The sync sends the fixed license payload and nothing else
    When the daily sync runs
    Then it sends the license token, the instance id, the LangWatch version, the full member seats in use and the Lite Member seats in use
    And it sends no organization name, no hostname, no user data and no product statistics

  @unit
  Scenario: The instance id on sync is the one the gateway sees
    When the daily sync runs
    Then it sends the same instance id the install presents to the hosted services
    And the instance id does not contain the organization name

  @unit
  Scenario: Product statistics stay optional and separate
    Given usage statistics are disabled for the deployment
    When the daily jobs run
    Then the license sync is sent
    And no product statistics are sent

  @unit
  Scenario: Product statistics go to the connect host, not the app host
    Given usage statistics are enabled for the deployment
    When the daily jobs run
    Then the product statistics are posted to the connect host

  @integration
  Scenario: An install on an older version still reaches the old statistics route
    When an older install posts its daily statistics to the app host route
    Then the post is accepted as before

  @unit
  Scenario: An install without a license sends no sync
    Given an organization with no license
    When the daily jobs run
    Then no license sync is sent

  @unit
  Scenario: An install with Connect disabled sends no sync
    Given a self-hosted install with Connect disabled
    When the daily jobs run
    Then no license sync is sent

  # ============================================================================
  # The connect side
  # ============================================================================

  @integration
  Scenario: A sync records the reported seats and answers with a lease
    When the install syncs reporting 53 full member seats in use
    Then LangWatch records 53 seats reported for that license and the time of the sync
    And the response carries a signed lease with the entitled services and the seat overage allowance
    And the lease says to warn after 14 days and expires after 30

  @unit
  Scenario: The highest seat count of the quarter is what is kept for billing
    Given the install reported 53 seats on one day and 51 on a later day in the same quarter
    Then the seats recorded for that quarter are 53

  @unit
  Scenario: A sync from an unregistered, revoked or wrong-instance license is refused
    When a sync arrives with a license that is not registered, is revoked, or is bound to another instance
    Then it is refused with the same codes the gateway uses
    And no seats are recorded

  @unit
  Scenario: A sync with a malformed payload is refused
    When a sync arrives with seat counts that are not whole non-negative numbers
    Then it is refused as invalid
    And no seats are recorded

  @unit
  Scenario: Sync is rate limited per license
    When the same license syncs far more often than once a day
    Then the extra syncs are refused as too many requests

  # ============================================================================
  # The lease on the install
  # ============================================================================

  @unit
  Scenario: A lease with a valid signature is applied
    When the install receives a lease signed by LangWatch for its license and its instance
    Then it stores the lease
    And the entitled services and the seat overage allowance come from that lease

  @unit
  Scenario: A lease that was tampered with is ignored
    When the install receives a lease whose allowance was edited after signing
    Then the lease is ignored
    And the previous lease stays in effect

  @unit
  Scenario: A lease for another license or another instance is ignored
    When the install receives a validly signed lease that names a different license or a different instance
    Then the lease is ignored

  # ============================================================================
  # Seats over the license
  # ============================================================================

  @unit
  Scenario: A connected license may go over its seats by the allowance
    Given a current lease with a seat overage allowance of 5
    And 50 full member seats are in use
    When an admin invites another full member
    Then the invitation is accepted

  @unit
  Scenario: The allowance is a ceiling too
    Given a current lease with a seat overage allowance of 5
    And 55 full member seats are in use
    When an admin invites another full member
    Then the invitation is refused for exceeding the licensed seats

  @integration
  Scenario: Going over the licensed seats says that it will be billed
    Given a current lease with a seat overage allowance of 5
    And 50 full member seats are in use
    When an admin invites another full member
    Then they are told the seat is over the license and will be invoiced at the next quarterly true-up
    And the members page shows 50 licensed, 51 in use and 1 to be invoiced

  @unit
  Scenario: The allowance is kept while sync has failed for less than 14 days
    Given sync has been failing for 10 days
    And 52 full member seats are in use on a license for 50 with an allowance of 5
    When an admin invites another full member
    Then the invitation is accepted
    And no seat warning is shown

  @unit
  Scenario: Between day 14 and day 30 the allowance is kept and admins are warned
    Given sync has been failing for 20 days
    And 52 full member seats are in use on a license for 50 with an allowance of 5
    When an admin invites another full member
    Then the invitation is accepted
    And admins see a warning that names the day the seat allowance will be withdrawn

  @unit
  Scenario: After day 30 the allowance is withdrawn
    Given the last lease expired because sync has failed for more than 30 days
    And 53 full member seats are in use
    When an admin invites another full member
    Then the invitation is refused for exceeding the licensed seats
    But every existing member keeps working

  @integration
  Scenario: A failing sync is visible from the first failure
    Given sync has been failing for 1 day
    When an admin opens Settings, Connect
    Then the page shows when sync last succeeded and why it is failing

  @unit
  Scenario: A sync that succeeds again restores the allowance
    Given the last lease expired
    When a sync succeeds
    Then the new lease is applied and the allowance is back

  @unit
  Scenario: An air-gapped install keeps the hard cap
    Given a self-hosted install with Connect disabled
    And 50 full member seats are in use on a license for 50
    When an admin invites another full member
    Then the invitation is refused for exceeding the licensed seats

  # ============================================================================
  # License delivery
  # ============================================================================

  @integration
  Scenario: A reissued license arrives over sync and is applied
    Given LangWatch reissued the license with 80 seats
    When the install syncs
    Then the response carries the reissued license
    And the install verifies it and stores it in place of the old one
    And the license page shows 80 seats

  @unit
  Scenario: A delivered license that does not verify is not applied
    When the sync response carries a license whose signature does not verify
    Then the install keeps its current license
    And the failure is shown in Settings, Connect

  @unit
  Scenario: The replaced license is retired once the new one is in use
    Given the install applied a reissued license
    When it syncs with the new license
    Then LangWatch marks the replaced license as superseded
    And the replaced license no longer resolves as a credential
