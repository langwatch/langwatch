# Pull request linkage, sessions mapped to GitHub pull requests and priced
#
# Implementation:
#   platform/app/src/server/app-layer/github/github-pull-request-mapping.service.ts   (branch-to-PR mapping + negative cache)
#   platform/app/src/server/app-layer/github/github-pull-request-status.service.ts    (live status, Redis-cached, never the queue)
#   platform/app/src/server/event-sourcing/pipelines/coding-agent-processing/reactors/pullRequestMapping.reactor.ts (fold trigger)
#   platform/app/src/server/app-layer/coding-agent/pull-request-assignment.ts          (session-to-PR tenure rule)
#   platform/app/src/server/app-layer/coding-agent/pull-request-usage.service.ts       (org-first usage rollup)
#   platform/app/src/app/api/coding-agent/[[...route]]/                                (the usage REST endpoint)
#   platform/app/src/pages/me/pull-requests.tsx                                        (the personal Pull Requests page)
#
# Related specs:
#   specs/coding-agent/session-git-context.feature   , where the repo+branch identity comes from
#   specs/integrations/github-connection.feature     , the org-level GitHub connection this rides
#
# Motivation: the ledger question "what did this pull request cost in assistant
# usage". Sessions carry repo+branch; the organization's GitHub connection maps
# branches to pull requests (all PRs a branch ever hosted, stored durably);
# sessions attach to PRs at read time by the PR's lifetime, so cost attribution
# survives branch recycling and sessions that ran before the PR was opened.
# PR STATUS is always fetched live by the reader, never maintained by the queue;
# the stored state is only a fallback label. The usage rollup is organization
# first and RBAC-scoped: numbers only, never content.

Feature: Pull request linkage

Rule: Branches map to their pull requests through the organization connection

  @integration
  Scenario: A folded session carrying repo and branch maps its branch's pull requests
    Given an organization with a GitHub connection covering the session's repository
    And a folded coding-agent session carrying that repository and a branch
    When the mapping for the branch runs
    Then every pull request whose head is that branch is stored for the organization

  @integration
  Scenario: An empty answer arms the negative cache
    Given a mapped branch that has no pull request yet
    When the mapping for the branch runs again inside the backoff window
    Then GitHub is not asked a second time

  @integration
  Scenario: A pull request opened after the session went quiet is still found
    Given a session whose branch had no pull request when it folded
    When a pull request for that branch is opened later
    Then the periodic recheck maps it without any new session activity

  @unit
  Scenario: Rechecks stop for branches with no recent session activity
    Given a branch whose sessions all ended more than a week ago
    When the periodic recheck selects branches
    Then that branch is not rechecked

  @unit
  Scenario: A repository on a non-GitHub host never triggers a GitHub call
    Given a session whose repository host is not github.com
    When the mapping trigger evaluates the session
    Then no mapping is requested

  @integration
  Scenario: Connecting GitHub backfills recent branches
    Given sessions with repo and branch folded before any GitHub connection existed
    When the organization connects GitHub
    Then the recent branches are mapped without waiting for new sessions

Rule: Sessions attach to pull requests by the pull request's lifetime

  @unit
  Scenario: Sessions before and during a pull request both attach to it
    Given a branch whose pull request opened between two sessions
    When sessions are assigned to pull requests
    Then the session that ran before the pull request opened attaches to it
    And the session that ran while it was open attaches to it

  @unit
  Scenario: A recycled branch splits sessions between its pull requests
    Given a branch that hosted a merged pull request and later a new one
    When sessions are assigned to pull requests
    Then sessions from the first pull request's era attach to the first
    And later sessions attach to the successor

  @unit
  Scenario: A session maps to at most one pull request
    Given a branch with several pull requests over time
    When sessions are assigned to pull requests
    Then no session is counted under two pull requests

Rule: Pull request status is read live, never maintained by the queue

  @unit
  Scenario: Live status derives open, draft, merged and closed
    Given pull requests in each state on GitHub
    When their live status is read
    Then each derives the matching status from state, draft flag and merge time

  @integration
  Scenario: Live status is cached briefly
    Given a pull request whose live status was just read
    When the status is read again within the cache window
    Then GitHub is not asked a second time

  @unit
  Scenario: A rate limited live read falls back to the stored snapshot
    Given GitHub rate limits the live status read
    When the status is read
    Then the stored snapshot label is returned, marked as a snapshot

Rule: The Pull Requests page prices each pull request's lifetime

  @integration
  Scenario: The page rolls up sessions, tokens and cost per pull request
    Given mapped pull requests with sessions attached across their lifetimes
    When the pull request usage is read for the caller's project
    Then each pull request reports its sessions count, tokens and assistant cost
    And the figures cover the pull request's lifetime, not a time picker window

  @unit
  Scenario: A viewer without a GitHub connection sees the connect invitation
    Given an organization with no GitHub connection
    When the Pull Requests page loads
    Then an organization manager is invited to connect GitHub
    And a member without that permission is told to ask an administrator

  @unit
  Scenario: A session repository not covered by the connection offers linking it
    Given a session whose repository no installation covers
    When the Pull Requests page lists it
    Then an organization manager is offered to link that repository

Rule: The organization-wide usage read is RBAC-scoped and numbers only

  @integration
  Scenario: Cross-project totals include only projects the caller can view
    Given sessions for one pull request across two projects
    And the caller may view traces in only one of them
    When the pull request usage is read for the organization
    Then only the permitted project's rows appear
    And the totals equal the permitted rows alone

  @integration
  Scenario: A project without the cost permission returns tokens with no cost
    Given a project where the caller may view traces but not costs
    When the pull request usage is read for the organization
    Then that project's rows carry token counts
    And that project's cost is absent

  @unit
  Scenario: The usage response never carries content
    Given a pull request with sessions that have titles and transcripts
    When the pull request usage is read
    Then the response carries numbers, names and branch names only

  @integration
  Scenario: An unmapped pull request returns the named failure
    Given a repository and pull request number no mapping knows
    When the pull request usage is read
    Then the caller receives the pull request not mapped failure
