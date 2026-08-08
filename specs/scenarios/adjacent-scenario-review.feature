Feature: Adjacent Scenario Review
  As a LangWatch user
  I want to review, approve, or reject each generated variant scenario
  So that only meaningful, correct variants become permanent regression coverage

  Background:
    Given I am logged into project "my-project"
    And a fan-out batch exists with 6 generated variants pending review

  # ============================================================================
  # Viewing the Batch
  # ============================================================================

  @integration
  Scenario: Open the review drawer for a batch
    When I open the review drawer for the batch
    Then I see each variant's lens, name, situation, criteria and rationale
    And each variant is marked pending

  @integration
  Scenario: Nothing reaches the scenario library unreviewed
    When generation finishes
    Then every generated variant is awaiting a human decision

  @integration @unimplemented
  Scenario: See a criteria-diff badge when a variant's criteria changed from the seed
    Given a variant generated under the "boundary_value" lens has different criteria than the seed
    When I open the review drawer
    Then that variant shows a criteria-changed badge

  # ============================================================================
  # Approving and Rejecting
  # ============================================================================

  @e2e @unimplemented
  Scenario: Approve selected variants via the floating action bar
    Given I am viewing the review drawer
    When I select 3 variants
    And I click "Approve selected" on the floating action bar
    Then those 3 variants are marked approved
    And the floating action bar disappears once nothing is selected

  @e2e @unimplemented
  Scenario: Reject selected variants via the floating action bar
    Given I am viewing the review drawer
    When I select 2 variants
    And I click "Reject selected" on the floating action bar
    Then those 2 variants are marked rejected

  @integration
  Scenario: Approve or reject a single variant from its row menu
    Given I am viewing the review drawer
    When I click "Approve" in a variant's row menu
    Then that variant is marked approved
    And no other variant's status changes

  @integration
  Scenario: Rejecting a variant archives its scenario
    Given I am viewing the review drawer
    When I reject a variant
    Then the scenario behind it is archived
    And the scenarios behind the other variants are untouched

  @integration @unimplemented
  Scenario: Edit a variant before approving it
    Given I am viewing the review drawer
    When I click "Edit" in a variant's row menu
    Then I am taken to the scenario editor for that variant's already-persisted scenario
    When I save changes and return to the review drawer
    Then the variant reflects my edits and is still pending

  # ============================================================================
  # Tenant Isolation
  # ============================================================================
  # A variant carries no project of its own, so these are a property of the
  # queries rather than of the multitenancy middleware.

  @integration
  Scenario: Deciding on another project's batch changes nothing
    Given a fan-out batch that belongs to a different project
    When I submit decisions against it from my project
    Then the decision is refused
    And every variant in that batch is left pending

  @integration
  Scenario: Deciding on a variant outside the batch changes nothing
    Given a decision set that names a variant from another batch
    When I submit it
    Then the whole set is refused
    And no variant in either batch changes status

  # ============================================================================
  # Batch State
  # ============================================================================

  @integration
  Scenario: Batch moves to ready-for-review once generation completes
    Given a fan-out batch is generating
    When generation finishes successfully
    Then the batch status becomes ready-for-review
    And it never reports ready with nothing to review

  @integration @unimplemented
  Scenario: "Run approved" only appears once at least one variant is approved
    Given I am viewing the review drawer with all variants pending
    Then I do not see a "Run approved" action
    When I approve at least one variant
    Then I see a "Run approved" action

  @integration
  Scenario: Rejected variants are excluded from dispatch
    Given a batch has 4 approved and 2 rejected variants
    When I click "Run approved"
    Then only the 4 approved variants are queued to run
