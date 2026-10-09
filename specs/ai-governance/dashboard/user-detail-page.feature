@governance @dashboard @user-detail
Feature: User detail — what one person's page shows today
  The page a governance admin lands on after clicking a person in the
  People tab. It shows that person's headline spend and activity from the
  same rollup the tab reads. The deeper breakdowns are not built, so the
  page says they are not available rather than describing them as work
  already under way. Same rule as the team detail page.
  Decision: none — copy honesty on an existing page.

  Background:
    Given an organization member with the governance view permission
    And "release_ui_ai_governance_enabled" is enabled for the organization
    And the member may read the activity monitor

  @integration
  Scenario: The person page names the breakdowns it does not have yet
    When the member opens a person's detail page
    Then the detail panel says "Per-day spend trend and per-model breakdown
      for this user are not available yet."
    And no copy says those breakdowns are arriving in a follow-up
    # A reader cannot act on our release plan, and "in a follow-up" is our
    # word for it, not theirs. What they can act on is knowing the number
    # is not there.
