Feature: Gateway budget decision service

  @unit
  Scenario: A projected request reaches a hard budget limit
    Given an applicable BLOCK budget with 0.50 USD spent and a 1.00 USD limit
    When the Gateway checks a projected cost of 0.50 USD
    Then it returns decision "hard_block"
    And it includes blockedBy and scopes with the existing wire fields

  @unit
  Scenario: Provider-filtered budgets only apply to their provider
    Given an applicable budget filtered to the OpenAI provider
    When the Gateway checks a request for another provider
    Then that budget is absent from the scopes response

  @unit
  Scenario: The process owns one budget decision service
    Given the API, CLI, and Gateway routes use the application instance
    When multiple requests perform budget checks
    Then they share the same Gateway service and repository instances

  @unit
  Scenario: A cache-rule mutation refreshes the Gateway configuration atomically
    Given an active cache rule for an organization
    When the rule is created, updated, or archived
    Then its row mutation, Gateway change event, and audit record use one persistence transaction

  @unit
  Scenario: A configuration bundle includes only eligible persistence records
    Given an organization has enabled and archived cache rules and a virtual key targets a trace project
    When the Gateway materialises its configuration bundle
    Then it includes only enabled non-archived cache rules and guardrail attachments present in that project catalogue

  @unit
  Scenario: A budget's spend and recent ledger read across its organisation's projects under the tenant guard
    Given a budget whose organisation has two projects writing to the ledger
    When its detail reads the recent ledger, the spend per target and the spend per bucket
    Then each read is one statement declaring both projects as its tenant set, which the tenant guard accepts

  @unit
  Scenario: A budget whose organisation has no projects reads no ledger
    Given a budget whose organisation has no projects
    When its detail reads the recent ledger and its spend
    Then each read answers empty without sending a statement

  @integration
  Scenario: A budget listing carries each row's scope reach
    Given a page of budgets, one of which no active key can reach
    When the budget list is answered
    Then each row carries scope_reach from the same per-row reach read the detail route uses

  @integration
  Scenario: A budget read on its own carries its scope reach
    Given a budget no active key can reach
    When the budget is read by id
    Then the answer carries scope_reach "unreachable", as its row in the budget list does

  @integration
  Scenario: A budget reset answers with the row it moved, carrying no reach read
    Given a budget whose period is reset
    When the reset answers with the row it moved
    Then the answer carries no scope_reach field

  @unit
  Scenario: A per-member overview refuses a caller outside the organization
    Given a caller who is not a member of the organization
    When they ask for the per-member budget overview
    Then the answer reports no gateway access
    And the organization's keys and budgets are never read

  @unit
  Scenario: A member's overview reads only their own organization's budgets
    Given a member of the organization
    When they ask for the budget overview
    Then the answer reports access and the budget read is scoped to that organization

  @integration
  Scenario: Personal-key usage on a budget's detail is visible only to its owner and to those allowed to see other members' personal keys
    Given a budget whose recent ledger holds a row spent through a shared key and one through a member's personal key
    When the key's owner, an organization admin, another member and a viewer each open the budget
    Then the owner and the admin see both rows
    And the other member and the viewer see only the shared key's row
    And a caller whose newest rows are all another member's still sees older shared rows, at most 20

  @integration
  Scenario: A budget scoped to one person or to a personal key opens only for that person and those allowed to see other members' personal keys
    Given a budget scoped to one member, and a budget scoped to that member's personal key
    When the member, an organization admin and a viewer each open, edit, reset or archive it
    Then the member and the admin reach it
    And the viewer is answered exactly as for a budget that does not exist
    And over the REST API, a key acting for the member or holding that permission at the organization reads it
    And any other key is answered exactly as for a budget that does not exist
    And a budget scoped to a shared key, or capping each end user of a key, opens for the viewer

  @integration
  Scenario: A budget on one person or on a personal key is created only by that person and those allowed to see other members' personal keys
    Given a member, that member's personal key, and a shared key
    When the member, an organization admin and another member each create a budget scoped to the member or to the personal key
    Then the member and the admin create it
    And the other member is refused exactly as for a target that does not exist: the key as virtual_key_not_found, the member as gateway_scope_org_mismatch
    And over the REST API, a key acting for the member or holding that permission at the organization creates it, and any other key is refused the same way
    And a budget scoped to the shared key is created for anyone allowed to create budgets

  @unit
  Scenario: A key with no owner whose creator's account is gone counts as personal on a budget's detail
    Given a budget whose recent ledger holds a row from a key with no principal, never marked personal, whose creator's account is gone
    When a member opens the budget
    Then that row is not shown
    And an organization admin still sees it
    And when the account lookup fails, the read fails rather than counting the account as gone

  @unit
  Scenario: A key a machine created never counts as personal on a budget's detail
    Given a budget whose recent ledger holds a row from a key with no principal, created by a project credential whose creator id starts with "svc_"
    When a member opens the budget
    Then that row is shown
    And no account is looked up for its creator

  @unit
  Scenario: A key minted for a person stays personal after its principal is cleared
    Given a virtual key created with a principal user
    Then the same write marks it minted as personal
    And a key created without a principal is not marked
    And an update of a key never writes a principal or the mark

  @unit
  Scenario: Keys minted for a person before the mark existed are marked by a background step
    Given keys that carry a principal but no mark, and a key that carries no principal
    When the background step runs
    Then each key with a principal is marked, and progress is saved after each page
    And the key without a principal is left unmarked
    And a second run marks nothing
    And a dry run marks nothing and saves no progress
    And a resumed run counts on from the total its checkpoint saved
    And marking a key leaves its last edit time as it was
