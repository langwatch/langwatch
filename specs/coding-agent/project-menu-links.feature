# Project menu links for coding-agent activity
#
# Implementation:
#   platform/app/prisma/schema.prisma                                                                              (Project.lastCodingAgentSessionAt / lastCodingAgentPullRequestAt)
#   platform/app/src/server/app-layer/projects/project.service.ts                                                  (the throttled touch methods)
#   platform/app/src/server/app-layer/projects/repositories/project.prisma.repository.ts                           (the staleness-guarded write)
#   platform/app/src/server/event-sourcing/pipelines/coding-agent-processing/projections/codingAgentSessionSeen.touch.ts (the fold-commit stamp)
#   platform/app/src/server/app-layer/github/github-pull-request-mapping.service.ts                                (the pull-request trigger)
#   platform/app/src/components/sidebar/codingAgentActivity.ts                                                     (the recency rule)
#   platform/app/src/components/MainMenu.tsx                                                                       (the two destinations)
#   platform/app/src/pages/[project]/sessions.tsx                                                                  (the project Sessions page)
#   platform/app/src/pages/[project]/pull-requests.tsx                                                             (the project Pull Requests page)
#
# Related specs:
#   specs/coding-agent/sessions-screen.feature       , what the Sessions table shows
#   specs/coding-agent/pull-request-linkage.feature  , where the pull requests come from
#   specs/navigation/project-scoped-destinations.feature , how a project destination behaves without a project
#
# Motivation: the sidebar has to say what a project is for without asking
# anybody to configure it. A project that sends coding-agent telemetry gets a
# Sessions destination, and one whose work reaches pull requests gets a Pull
# requests destination. Neither is a setting: both are grown by what the
# project recorded, and both go away again when the recording goes stale, so a
# project that never ran a coding agent never carries a link to an empty page.
#
# The recording is deliberately coarse. Each destination is driven by one
# recorded moment rather than a count, and the write is skipped while the
# stored moment is still recent, so the busiest project costs a handful of
# writes a day rather than one per folded session.

Feature: Project menu links for coding-agent activity

Rule: The project rail grows its coding-agent destinations from recorded activity

  @integration
  Scenario: A project that records coding-agent sessions offers the Sessions destination
    Given a project that recorded a coding-agent session in the last fifteen days
    When a member with permission to read the project's traces opens it
    Then the project rail offers the Sessions destination

  @integration
  Scenario: A project whose work reaches pull requests offers the Pull requests destination
    Given a project that had a pull request linked in the last fifteen days
    When a member with permission to read the project's traces opens it
    Then the project rail offers the Pull requests destination

  @integration
  Scenario: Each destination is grown by its own signal
    Given a project that recorded coding-agent sessions and has no pull request linked
    When a member with permission to read the project's traces opens it
    Then the project rail offers the Sessions destination
    And the project rail does not offer the Pull requests destination

  @integration
  Scenario: A project with no coding-agent activity carries neither destination
    Given a project that recorded nothing from a coding agent
    When a member opens it
    Then the project rail offers neither coding-agent destination

  @integration
  Scenario: A project that stopped recording coding-agent sessions loses the destination
    Given a project whose last coding-agent session is older than fifteen days
    When a member opens it
    Then the project rail no longer offers the Sessions destination

  @unit
  Scenario: The recency window closes at fifteen days
    Given a recorded moment exactly fifteen days old
    When the rail decides whether to offer the destination
    Then the moment reads as stale

  @integration
  Scenario: Recent activity alone does not open the destinations
    Given a project that recorded coding-agent sessions and pull requests today
    When the coding-agent pages are not released for the organization, or the
    viewer may not read the project's traces
    Then the project rail offers neither coding-agent destination

Rule: The project rail marks the coding-agent destination the reader is on

  The rail decides what is open from the route pattern the router reports, so
  a destination whose route the router cannot name reads as never open and the
  rail marks nothing while the reader is standing on the page.

  @integration
  Scenario: The rail marks the Sessions destination while the Sessions page is open
    Given a member reading the project's Sessions page
    When the project rail is drawn
    Then the Sessions destination is marked as the open one
    And the Pull requests destination is not marked

  @integration
  Scenario: The rail marks the Pull requests destination while the Pull requests page is open
    Given a member reading the project's Pull requests page
    When the project rail is drawn
    Then the Pull requests destination is marked as the open one
    And the Sessions destination is not marked

Rule: The destinations open onto this project's own work

  @integration
  Scenario: Opening the Sessions destination shows this project's sessions
    Given a member on a project that records coding-agent sessions
    When the member opens the Sessions destination
    Then the page lists the sessions of that project

  @integration
  Scenario: Opening the Pull requests destination shows this project's pull requests
    Given a member on a project whose work reaches pull requests
    When the member opens the Pull requests destination
    Then the page lists the pull requests of that project

  @integration
  Scenario: The pages stay closed when they are not released
    Given an organization the coding-agent pages are not released for
    When a member opens either page by its address
    Then the page is not found

  @integration
  Scenario: Neither page claims anything while the workspace is still resolving
    Given a member whose workspace has not resolved yet
    When the Sessions page opens
    Then the page waits instead of reporting that nothing was recorded

Rule: A folded session records its project's activity, rarely

  @integration
  Scenario: A folded coding-agent session records the project's activity
    Given a project with no recorded coding-agent activity
    When a coding-agent session folds for that project
    Then the project records that a session was seen
    And the project records nothing about pull requests

  @integration
  Scenario: A busy project is written to at most once an hour
    Given a project that recorded a coding-agent session moments ago
    When another session folds for the same project
    Then the recorded moment is left alone

Rule: A pull request found for a project's own session records it on that project

  @integration
  Scenario: A pull request found for a project's session records it on the project
    Given a project whose folded session asked about its branch
    When the organization's GitHub connection answers with a pull request
    Then the project records that a pull request was seen

  @integration
  Scenario: A branch with no pull request records nothing on the project
    Given a project whose folded session asked about its branch
    When the organization's GitHub connection answers with no pull request
    Then the project records nothing about pull requests

  @integration
  Scenario: Connecting GitHub records the backfilled pull requests on their projects
    Given a project whose recorded sessions name their branches
    When the organization connects GitHub and the backfill finds a pull request for one of those branches
    Then the project records that a pull request was seen

  @integration
  Scenario: A pull request announced over the webhook records nothing on any project
    Given an organization whose GitHub connection announces a pull request
    When the announcement is applied
    Then the pull request is linked for the organization
    And no project records that a pull request was seen
