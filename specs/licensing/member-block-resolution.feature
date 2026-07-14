Feature: Member limit denials carry a typed resolution everywhere
  # ADR-039 rollout step 6 / Decisions 5, 9, 10, 13. Every path that can deny
  # adding a full member returns the same typed resolution, the UI routes it
  # through one handler, ops alerts split by resolution, and the seat-billed
  # incident class (blocked instead of offered a seat) can never recur.

  As an organization administrator on a seat-billed plan
  I want every member-add denial to offer me the way forward
  So that I am never dead-ended while willing to pay for another seat

  # --- The incident regression ---

  @regression @integration @unimplemented
  Scenario: A seat-billed organization with a stale TIERED column is offered a seat purchase, not blocked
    Given an organization with pricingModel "TIERED" and an ACTIVE seat-event subscription at its member cap
    When an admin submits an invite for a new full member
    Then the seat purchase confirmation is offered
    And no hard-block error is returned

  # --- Typed resolution on every denial path (Decision 5) ---

  @integration @unimplemented
  Scenario: Admin invite denial carries the resolution
    Given an organization at its full member cap
    When an admin creates an invite for a new full member
    Then the denial includes the plan's member resolution

  @integration @unimplemented
  Scenario: Non-admin invite request denial carries the resolution
    Given an organization at its full member cap
    When a non-admin submits an invite request for a new full member
    Then the denial includes the plan's member resolution

  @integration @unimplemented
  Scenario: Invite approval denial carries the resolution
    Given an organization at its full member cap with an invite awaiting approval
    When an admin approves the pending invite
    Then the denial includes the plan's member resolution

  @integration @unimplemented
  Scenario: Lite-to-full role change denial carries the resolution
    Given an organization at its full member cap with a lite member
    When an admin changes the lite member's role to a full member role
    Then the denial includes the plan's member resolution

  @integration @unimplemented
  Scenario: Public API limit denial carries the resolution as advisory metadata
    Given an organization at a resource limit
    When an API client hits the limit through the public API
    Then the 403 response body includes the resolution field

  # --- One UI handler (Decision 10) ---

  @integration @unimplemented
  Scenario: Resolution purchase_seat opens the seat proration modal
    Given a member denial with resolution "purchase_seat"
    When the UI handles the denial
    Then the seat proration modal opens

  @integration @unimplemented
  Scenario: Resolution upgrade routes to plan management
    Given a member denial with resolution "upgrade"
    When the UI handles the denial
    Then the user is directed to the plan management page

  @integration @unimplemented
  Scenario: Resolution hard_cap directs to contact us
    Given a member denial with resolution "hard_cap"
    When the UI handles the denial
    Then the user is directed to contact support

  # --- Alert split (Decision 9) ---

  @integration @unimplemented
  Scenario: A purchase_seat denial produces an info breadcrumb, not an ops page
    Given an organization at its seat cap with resolution "purchase_seat"
    When the member denial is recorded
    Then an info-level notification is emitted
    And no ops alert fires

  @integration @unimplemented
  Scenario: A hard_cap denial fires a real ops alert
    Given an organization at its member cap with resolution "hard_cap"
    When the member denial is recorded
    Then an ops alert fires identifying the organization and limit

  # --- Pending invites surfaced (Decision 13) ---

  @integration @unimplemented
  Scenario: The member cap message itemizes members and pending invites
    Given an organization with 4 full members and 2 pending full-member invites on a 6-seat plan
    When an admin views the member limit state
    Then the count shows 4 members and 2 pending invites
    And each pending invite can be revoked from the same view

  @unit @unimplemented
  Scenario: Pending invites still reserve seats
    Given an organization with 4 full members and 2 pending full-member invites on a 6-seat plan
    When a member limit check runs for one more full member
    Then the check reports the cap as reached
