Feature: Cost breakdown by content category on governance dashboards

  Category cost totals (system prompt, user input, MCP, skills, tool results,
  thinking, ...) computed at ingestion surface on the existing governance
  dashboards: the personal usage view shows the user's own breakdown, and the
  org activity monitor shows the aggregate. Availability and permissions
  follow the host pages — no new gating. The numbers are analytics only and
  never affect billing, budgets, or plan limits. (ADR-033)

  @integration
  Scenario: The personal usage view shows the user's cost breakdown by category
    Given a user whose coding-agent traffic produced classified category totals
    When the user opens their personal usage view
    Then a usage breakdown section lists the categories with their cost share

  @integration
  Scenario: The breakdown shows an enablement hint when no content was captured
    Given a user whose traffic produced no category totals because payload capture is off
    When the user opens their personal usage view
    Then the breakdown section explains why the breakdown can be empty

  @integration
  Scenario: The org activity monitor aggregates category totals across users
    Given an organization with classified coding-agent traffic from several users
    When an admin with activity-monitor access opens the activity monitor
    Then the aggregate cost breakdown by category is shown

  @integration
  Scenario: Category totals never affect billing or plan limits
    Given a project with classified category totals recorded
    When usage limits and billing amounts are computed
    Then the computation reads no category classification data
