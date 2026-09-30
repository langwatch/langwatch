Feature: License sync
  A connected install reports its seat counts to LangWatch once a day and
  receives back the services its license is entitled to and, when one is
  waiting, a reissued license. A seat change or a renewal made on the registry
  reaches the install that way, on the next daily sync or when an admin presses
  refresh on the License page. The seats an install may fill are the seats
  signed into the license it holds, and nothing else.

  The sync carries metadata only. Product statistics are a separate, optional
  post with its own switch. An air-gapped install sends neither.

  As a LangWatch customer running a connected install
  I want seat changes and license renewals to flow through one outbound call
  So that I am never emailed a key again

  Background:
    Given a self-hosted install whose license names a hosted service
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
  Scenario: The instance identity names the install, not an organization
    Given an install carrying three organizations
    When anything asks this install for its identity
    Then one identity is answered, a random UUID minted into this install's own database
    And it carries no organization name and no organization id
    And asking again answers the same one, whichever organization asked

  @unit
  Scenario: Two processes minting the identity at once end with one identity
    Given an install that has never presented an identity
    When two processes mint one at the same time
    Then the one that loses the write takes the identity the winner minted

  @unit
  Scenario: An operator can name the identity this install presents
    Given a deployment configuration that names an instance id
    When anything asks this install for its identity
    Then the named one is answered and nothing is minted

  @unit
  Scenario: A refused usage report is recorded rather than logged and forgotten
    Given the last usage report was accepted
    When LangWatch refuses the next one
    Then the refusal is recorded against this install
    And the day the last report was accepted is left where it was

  @integration
  Scenario: The receiver accepts a report carrying a field it has never heard of
    Given a receiver running an older release than the install
    When the install posts a report naming a metric the receiver does not know
    Then the report is accepted
    And the unknown field is dropped before anything is recorded
    And the report is recorded with a count of how many fields were dropped

  @integration
  Scenario: The receiver accepts a report missing fields it expects
    Given a receiver running a newer release than the install
    When the install posts a report without the metrics added since
    Then the report is accepted with the fields it did send

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
  Scenario: A sync records the reported seats and answers with the entitled services
    When the install syncs reporting 53 full member seats in use
    Then LangWatch records 53 seats reported for that license and the time of the sync
    And the response carries the hosted services the license is entitled to

  @unit
  Scenario: The last report replaces the one before it
    Given the install reported 53 seats on one day and 51 on a later day
    Then the seats recorded for that license are 51, with the day of that report

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
  # Seats
  # ============================================================================

  @unit
  Scenario: The licensed seat count is the hard cap
    Given 50 full member seats are in use on a license for 50
    When an admin invites another full member
    Then the invitation is refused for exceeding the licensed seats
    But every existing member keeps working

  @integration
  Scenario: A failing sync is visible from the first failure
    Given sync has been failing for 1 day
    When an admin opens Settings, Connect
    Then the page shows when sync last succeeded and why it is failing

  # ============================================================================
  # Refresh on demand
  # ============================================================================

  @unit
  Scenario: An admin refreshes the license and gets the new seat count
    Given LangWatch changed the license to 80 seats
    When an admin presses refresh on the License page
    Then the sync runs now
    And the reissued license is verified and stored in place of the old one
    And the admin is told the license now covers 80 seats

  @unit
  Scenario: An admin refreshes a license that is already current
    Given LangWatch has no newer license for this install
    When an admin presses refresh on the License page
    Then the admin is told the license is up to date
    And the time of the sync is recorded

  @unit
  Scenario: A refresh that the registry rate limits is refused with its code
    Given the license has synced as often as the registry allows in a day
    When an admin presses refresh on the License page
    Then the refusal is shown with the code the registry named
    And it is recorded as the last sync failure

  @unit
  Scenario: Refresh is offered on a connected license only
    Given an install on an offline license, or with Connect disabled
    When an admin opens the License page
    Then there is no refresh button
    And a refresh asked for anyway is refused

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
