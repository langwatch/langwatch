@governance @dashboard @team-detail
Feature: Team detail — what one team's page shows today
  The page a governance admin lands on after clicking a team in the
  bird's-eye chart. It shows that team's headline spend and activity from
  the same rollup the chart reads, and offers two links out: the team's
  workspace traces, and the chart itself. The deeper breakdowns are not
  built, so the page says they are not available rather than describing
  them as work already under way.

  Every control on the page navigates. There is no control that answers a
  press with nothing, and no sentence that describes an unbuilt breakdown
  as something that exists.
  Decision: none — copy and control honesty on an existing page.

  Background:
    Given an organization member with the governance view permission
    And "release_ui_ai_governance_enabled" is enabled for the organization
    And the member may read the activity monitor

  @integration
  Scenario: The page names the breakdowns it does not have yet
    Given the team has spend in the last 30 days
    When the member opens that team's detail page
    Then the detail panel says "Per-day spend, per-user breakdown and model
      mix for this team are not available yet."
    And no copy says those breakdowns are arriving in a follow-up
    # A reader cannot act on our release plan, and "in a follow-up" is our
    # word for it, not theirs. What they can act on is knowing the number
    # is not there.

  @integration
  Scenario: Every control on the page navigates somewhere real
    Given the team has spend in the last 30 days
    When the member opens that team's detail page
    Then every control on the page is a link with a destination
    And no control is offered that answers a press with nothing

  @integration
  Scenario: The links describe where they land in the reader's own words
    Given the team has spend in the last 30 days
    When the member opens that team's detail page
    Then the traces link is described as opening this team's data
    And the chart link is described as showing this team's spend next to
      every other team's
    # The line stops there deliberately. It used to promise a "Viewing as
    # admin" banner and an audit-log entry, and a team drill-through gets
    # neither: both key off a personal workspace owned by somebody else, and
    # an org team is not one. See admin-trace-access.feature, which says no
    # banner renders because an org admin's membership cascades to every team.
    # Neither line may name an internal route, spell "and" as a plus sign,
    # or reach for "orthogonal lens" and "drilldown" to say "view".
