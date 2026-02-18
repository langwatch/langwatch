Feature: Proration Preview Before Seat Update
  As a Growth plan (SEAT_EVENT) administrator
  I want to see the prorated charges before confirming a seat update
  So that I understand exactly what I'll be charged before committing

  Background:
    Given I am logged in as an organization administrator on LangWatch Cloud
    And the organization uses the SEAT_EVENT pricing model
    And the organization has an active Growth subscription

  # ============================================================================
  # Backend: Proration Preview Query
  # ============================================================================

  @integration
  Scenario: Preview proration returns upcoming invoice details
    Given the organization has a Stripe subscription with 5 seats
    When I request a proration preview for 7 total seats
    Then the preview returns the prorated amount due
    And the preview returns line items with credits and charges
    And the preview returns the new recurring total

  @integration
  Scenario: Preview proration fails without active subscription
    Given the organization has no active subscription
    When I request a proration preview for 3 total seats
    Then the request fails with PRECONDITION_FAILED
    And the error message indicates no active subscription

  @integration
  Scenario: Preview proration fails without seat line item
    Given the organization has a Stripe subscription without a seat price item
    When I request a proration preview for 5 total seats
    Then the request fails with PRECONDITION_FAILED
    And the error message indicates no seat item found

  # ============================================================================
  # Upgrade Modal: Limit Mode (Backward Compatibility)
  # ============================================================================

  @integration
  Scenario: Existing limit upgrade modal still works for non-SEAT_EVENT limits
    Given the organization has reached its team member limit
    When the upgrade modal opens for a limit enforcement
    Then I see "Upgrade Required" title
    And I see the limit type and current usage
    And I see a redirect button to the plan management page

  # ============================================================================
  # Upgrade Modal: Seats Mode (Proration Preview)
  # ============================================================================

  @integration
  Scenario: Seats mode modal shows proration preview
    Given I have triggered a seat update from 5 to 7 seats
    When the proration preview modal opens
    Then I see "Confirm Seat Update" title
    And I see current seats as 5 and seats available as 7
    And I see line items showing credits and charges
    And I see the prorated amount due now
    And I see the new recurring price per billing period

  @integration
  Scenario: Seats mode modal shows loading state while fetching preview
    Given I have triggered a seat update
    When the proration preview modal opens
    And the preview data is loading
    Then I see a loading spinner in the modal body

  @integration
  Scenario: Seats mode modal shows error state on preview failure
    Given I have triggered a seat update
    When the proration preview modal opens
    And the preview query fails
    Then I see an error message in the modal
    And the "Confirm & Update" button is disabled

  @integration
  Scenario: Confirming seat update executes the update
    Given I have triggered a seat update from 5 to 7 seats
    And the proration preview modal is open with preview data
    When I click "Confirm & Update"
    Then the seat update is executed
    And the modal closes
    And I see a success toast "Seats updated successfully"

  @integration
  Scenario: Cancelling proration preview does nothing
    Given I have triggered a seat update from 5 to 7 seats
    And the proration preview modal is open
    When I click "Cancel"
    Then the modal closes
    And no seat update is executed

  # ============================================================================
  # Subscription Page: Trigger Proration Modal
  # ============================================================================

  @integration
  Scenario: Adding seats on subscription page opens proration preview
    Given I am on the subscription page
    And the organization has an active Growth subscription with 5 seats
    When I add 2 seats in the seat management drawer
    And I click "Update subscription"
    Then the proration preview modal opens
    And it shows the update from 5 to 7 seats

  @integration
  Scenario: Subscription page update uses plan maxMembers as base
    Given I am on the subscription page
    And the organization has an active Growth subscription with maxMembers 5
    And the organization has 3 accepted core members
    When I add 2 seats in the seat management drawer
    And I click "Update subscription"
    Then the proration preview modal opens with new total of 7 seats
    And the base is 5 (from maxMembers), not 3 (from member count)

  # ============================================================================
  # Members Page: Trigger Proration Modal
  # ============================================================================

  @integration
  Scenario: Inviting core members beyond maxMembers opens proration preview
    Given I am on the members page
    And the organization has an active Growth subscription with maxMembers 5
    And the organization has 5 accepted core members
    When I invite 2 new core members
    Then the proration preview modal opens
    And it shows the update from 5 to 7 seats

  @integration
  Scenario: Inviting lite members does not trigger proration preview
    Given I am on the members page
    And the organization has an active Growth subscription with maxMembers 5
    And the organization has 5 accepted core members
    When I invite 1 new lite member (EXTERNAL role)
    Then no proration preview modal opens
    And the invite is created directly

  @integration
  Scenario: Inviting core members within maxMembers does not trigger proration
    Given I am on the members page
    And the organization has an active Growth subscription with maxMembers 5
    And the organization has 3 accepted core members
    When I invite 1 new core member
    Then no proration preview modal opens
    And the invite is created directly

  # ============================================================================
  # Business Logic: Seat Update Calculation
  # ============================================================================

  @unit
  Scenario: Seat update total uses subscription maxMembers as base
    Given a subscription with maxMembers 5
    And 3 current core members in the organization
    When calculating the new total for 2 additional seats
    Then the new total is 7 (maxMembers 5 + 2 seats available)

  @unit
  Scenario: Proration is needed when new core invites exceed maxMembers
    Given a subscription with maxMembers 5
    And 5 current core members
    When checking if 2 new core invites need proration
    Then proration is needed

  @unit
  Scenario: Proration is not needed when core invites stay within maxMembers
    Given a subscription with maxMembers 5
    And 3 current core members
    When checking if 1 new core invite needs proration
    Then proration is not needed

  @unit
  Scenario: Lite member invites never trigger proration check
    Given a subscription with maxMembers 5
    And 5 current core members
    When checking if 2 new lite member invites need proration
    Then proration is not needed

  # ============================================================================
  # Store: Discriminated Variant
  # ============================================================================

  @unit
  Scenario: Store open() opens modal in limit enforcement mode
    When open() is called with limitType "members" current 3 max 5
    Then isOpen is true
    And the modal is in limit enforcement mode

  @unit
  Scenario: Store openSeats() opens modal in seats confirmation mode
    When openSeats() is called with organizationId currentSeats 5 newSeats 7 and onConfirm callback
    Then isOpen is true
    And the modal is in seats confirmation mode

  @unit
  Scenario: Store close() closes the modal
    Given the store has an open modal
    When close() is called
    Then isOpen is false
