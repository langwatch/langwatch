Feature: Proration Preview Before Seat Update
  As a Growth plan (SEAT_EVENT) administrator
  I want to see the prorated charges before confirming a seat update
  So that I understand exactly what I'll be charged immediately before committing

  Seat upgrades are charged immediately (not deferred to the next invoice).
  The proration preview shows the exact amount that will be invoiced at the
  moment the update is confirmed.

  Background:
    Given I am logged in as an organization administrator on LangWatch Cloud
    And the organization uses the SEAT_EVENT pricing model
    And the organization has an active Growth subscription

  # ============================================================================
  # Backend: Proration Preview Query
  # ============================================================================

  # ============================================================================
  # Upgrade Modal: Limit Mode (Backward Compatibility)
  # ============================================================================

  @integration @unimplemented
  Scenario: Existing limit upgrade modal still works for non-SEAT_EVENT limits
    Given the organization has reached its team member limit
    When the upgrade modal opens for a limit enforcement
    Then I see "Upgrade Required" title
    And I see the limit type and current usage
    And I see a redirect button to the plan management page

  # ============================================================================
  # Upgrade Modal: Seats Mode (Proration Preview)
  # ============================================================================

  @integration @unimplemented
  Scenario: Seats mode modal shows proration preview with immediate charge
    Given I have triggered a seat update from 5 to 7 seats
    When the proration preview modal opens
    Then I see "Confirm Seat Update" title
    And I see current seats as 5 and seats available as 7
    And I see line items showing credits and charges
    And I see the prorated amount to be charged immediately
    And I see the new recurring price per billing period

  @integration @unimplemented
  Scenario: Seats mode modal shows loading state while fetching preview
    Given I have triggered a seat update
    When the proration preview modal opens
    And the preview data is loading
    Then I see a loading spinner in the modal body

  @integration @unimplemented
  Scenario: Seats mode modal shows error state on preview failure
    Given I have triggered a seat update
    When the proration preview modal opens
    And the preview query fails
    Then I see an error message in the modal
    And the "Confirm & Update" button is disabled

  @integration @unimplemented
  Scenario: Cancelling proration preview does nothing
    Given I have triggered a seat update from 5 to 7 seats
    And the proration preview modal is open
    When I click "Cancel"
    Then the modal closes
    And no seat update is executed

  # ============================================================================
  # Subscription Page: Trigger Proration Modal
  # ============================================================================

  @integration @unimplemented
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

  # ============================================================================
  # Business Logic: Seat Update Calculation
  # ============================================================================

  @unit @unimplemented
  Scenario: Seat update total uses subscription maxMembers as base
    Given a subscription with maxMembers 5
    And 3 current core members in the organization
    When calculating the new total for 2 additional seats
    Then the new total is 7 (maxMembers 5 + 2 seats available)

  # ============================================================================
  # Store: Discriminated Variant
  # ============================================================================

