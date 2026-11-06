Feature: Renewing and replacing a self-hosted licence
  A self-hosted install renews in one of two ways. A connected install collects
  a reissued licence from LangWatch over the daily sync, even when the old term
  already ended. An air-gapped install takes a new licence file or key over the
  one it holds, in one step, without dropping to the open source plan between
  the two. A signed key set in LANGWATCH_LICENSE_KEY licenses the plan the same
  way a stored licence does.

  # ============================================================================
  # Connected: a renewal issued after the term ended
  # ============================================================================

  @unit
  Scenario: A renewal issued after the licence expired still reaches the install
    Given a connected install whose licence expired yesterday
    And LangWatch reissued it with a term ending next year
    When an admin presses refresh on the License page
    Then the sync answer carries the reissued licence
    And the install stores it in place of the expired one

  @unit
  Scenario: An expired licence with no renewal waiting is still refused as expired
    Given a connected install whose licence expired
    And LangWatch has not reissued it
    When the install syncs
    Then the sync is refused with the code connect_license_expired
    And no seats are recorded on the registry

  @unit
  Scenario: An expired licence collecting its renewal gets no hosted services
    Given a connected install whose licence expired
    And LangWatch reissued it
    When the install syncs
    Then the answer names no hosted service
    And the managed key of the expired licence is not rewritten

  @unit
  Scenario: An expired licence presented by another install collects nothing
    Given a licence bound to one install expired and was reissued
    When a different install presents the expired licence
    Then the sync is refused with the code connect_license_expired

  @unit
  Scenario: An expired licence reaches no other connect route
    Given a connected install whose licence expired and was reissued
    When the install presents the expired licence on any connect route other than the licence sync
    Then the call is refused with the code connect_license_expired

  @unit
  Scenario: The daily sync keeps running after a connected licence expires
    Given a connected install whose licence expired
    When the daily sync pass runs
    Then the install still calls LangWatch for its licence

  @integration
  Scenario: Refresh is offered on an expired connected licence
    Given a connected licence that expired
    When an admin opens the License page
    Then the page shows "Refresh license"

  # ============================================================================
  # Air-gapped: replacing the licence in one step
  # ============================================================================

  @integration
  Scenario: An admin replaces the installed licence with a new key
    Given an organization with an installed licence
    When an admin opens the License page and chooses "Replace license"
    And enters a new licence key
    Then the new licence is stored in place of the old one
    And the organization never runs without a licence between the two

  @unit
  Scenario: A replacement that does not verify keeps the current licence
    Given an organization with an installed licence
    When an admin replaces it with a key whose signature does not verify
    Then the replacement is refused with the code license_key_invalid
    And the installed licence stays in place

  @integration
  Scenario: Removing a licence asks first and says what the organization loses
    Given an organization with an installed licence
    When an admin presses "Remove license"
    Then a dialog asks to confirm the removal
    And it says the organization returns to the open source plan, losing the licensed seats and enterprise capabilities such as single sign-on, SCIM and audit logs
    And nothing is removed until the admin confirms

  # ============================================================================
  # A licence set in the environment
  # ============================================================================

  @unit
  Scenario: A signed key in LANGWATCH_LICENSE_KEY sets the plan of an organization with no stored licence
    Given LANGWATCH_LICENSE_KEY holds a signed Enterprise licence
    And an organization has no licence stored
    When the organization's plan is resolved
    Then the plan is the one the environment licence signs

  @unit
  Scenario: A stored licence wins over the environment licence
    Given LANGWATCH_LICENSE_KEY holds a signed licence
    And an organization stored a different licence
    When the organization's plan is resolved
    Then the plan is the one the stored licence signs

  @unit
  Scenario: An environment licence for another organization does not license this one
    Given LANGWATCH_LICENSE_KEY holds a licence bound to another organization
    When this organization's plan is resolved
    Then it runs on the open source plan

  @unit
  Scenario: An environment licence for another organization gives this one no hosted services
    Given LANGWATCH_LICENSE_KEY holds a licence naming a hosted service, bound to another organization
    And this organization stored no licence
    When this organization reads its hosted services or calls LangWatch
    Then it holds no credential and is shown as unlicensed for hosted services

  @integration
  Scenario: The License page shows a licence installed from the environment
    Given LANGWATCH_LICENSE_KEY holds a signed licence and the organization stored none
    When an admin opens the License page
    Then the page shows the licence's plan, seats and expiry
    And it says the licence is installed from the environment
    And there is no "Remove license" button
