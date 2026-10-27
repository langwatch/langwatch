Feature: Budget overview, the one source for every member-facing budget surface
  Every place that tells a member about a budget (the /me page, the
  `langwatch login` epilogue, the REST endpoint behind it) reads one
  service, so the numbers agree everywhere and every number says WHICH
  budget it belongs to: "used $2.43 of $100.00 (whole organization
  budget)" instead of a bare figure that reads as personal.

  Background:
    Given an organization with the AI gateway enabled
    And a member with a personal workspace and a personal virtual key

  # -- What the overview lists -------------------------------------------

  @integration
  Scenario: A member sees every budget that binds their key, labelled with its scope
    Given an organization-wide budget and a budget on the member themselves
    When the member reads their budget overview
    Then both budgets are listed with their current spend
    And the organization-wide budget is labelled "whole organization budget"
    And the budget on the member is labelled "personal budget"
    And the list is ordered most binding first

  @integration
  Scenario: A provider-filtered budget names its provider
    Given an organization budget that counts only one provider's spend
    When the member reads their budget overview
    Then that budget carries the provider's display name

  @integration
  Scenario: A department budget shows the member their own allowance, not the group total
    Given a per-member budget on a group the member belongs to
    And another group member has spent against their own allowance
    When the member reads their budget overview
    Then the department budget shows only the member's own spend
    And it is labelled as a department budget with the group's name
    And it is marked per-member

  # -- Gating ------------------------------------------------------------

  @integration
  Scenario: The overview says nothing when the organization has governance switched off
    Given the organization's governance flag is switched off
    When the member reads their budget overview
    Then the overview reports no gateway access
    And it lists no budgets

  @integration
  Scenario: The overview says nothing for a caller who is not a member of the organization
    Given a user who is not a member of the organization
    When that user reads a budget overview for the organization
    Then the overview reports no gateway access
    And it lists no budgets

  # -- One source --------------------------------------------------------

  @integration
  Scenario: Every surface reports the same spend for the same budget
    Given an organization budget with spend recorded in several projects
    When the /me overview, the CLI budget-overview endpoint, and the budgets settings page each report that budget
    Then all three report the same spent amount

  @integration
  Scenario: Spend recorded in an archived project still counts, on every surface
    Given an organization budget with spend recorded in an archived project
    When the /me overview, the CLI budget-overview endpoint, and the budgets settings page each report that budget
    Then all three include the archived project's spend
    And the figure matches the one the gateway enforces against

  @integration
  Scenario: An organization budget's recent activity lists debits from every project it spans
    Given an organization budget with debits recorded in two different projects
    When an admin opens that budget's detail page
    Then the recent activity lists the debits from both projects

  # -- CLI login epilogue ------------------------------------------------

  @unit
  Scenario: The login epilogue names each budget that applies to the key
    Given the member logs in with the CLI
    When the login ceremony renders
    Then each applicable budget renders as one line with its spend, limit, window, scope label, and reset day

  @unit
  Scenario: The login epilogue caps at three budgets and links the rest
    Given more than three budgets apply to the member's key
    When the login ceremony renders
    Then only the three most binding budgets render as lines
    And a final line counts the rest and links to the budgets settings page

  @unit
  Scenario: The login epilogue renders nothing without gateway access
    Given the member's organization gives them no gateway access
    When the login ceremony renders
    Then no budget line renders at all

  @unit
  Scenario: The login epilogue falls back to the legacy single line on a server without the overview
    Given the server predates the budget-overview endpoint
    When the login ceremony renders
    Then the legacy collapsed budget line renders

  @unit
  Scenario: The labelled budget lines replace the legacy single line
    Given the budget-overview endpoint returned the budgets that bind the member
    When the login ceremony renders
    Then the labelled budget lines render
    And the legacy collapsed budget line does not render
