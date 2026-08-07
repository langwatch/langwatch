# Pull request linkage, sessions mapped to GitHub pull requests and priced
#
# Implementation:
#   platform/app/src/server/app-layer/github/github-pull-request-mapping.service.ts   (branch-to-PR mapping + negative cache)
#   platform/app/src/server/app-layer/github/github-pull-request-status.service.ts    (live status, Redis-cached, never the queue)
#   platform/app/src/server/event-sourcing/pipelines/coding-agent-processing/reactors/pullRequestMapping.reactor.ts (fold trigger)
#   platform/app/src/server/app-layer/coding-agent/pull-request-assignment.ts          (session-to-PR tenure rule)
#   platform/app/src/server/app-layer/coding-agent/pull-request-usage.service.ts       (org-first usage rollup)
#   platform/app/src/server/app-layer/coding-agent/coding-agent-source-type.ts         (agent id to ingestion source type)
#   platform/app/src/server/app-layer/coding-agent/repositories/coding-agent-session-events.repository.ts (per-model totals)
#   platform/app/src/server/organizations/resolveCallerProjectScope.ts                 (the caller's permission cut and how each project is named, shared by both read surfaces)
#   platform/app/src/app/api/coding-agent/[[...route]]/                                (the usage REST endpoint)
#   platform/app/src/pages/me/pull-requests.tsx                                        (the personal Pull Requests page)
#   platform/app/src/components/me/PullRequestsTable.tsx                               (the table)
#   platform/app/src/components/me/PullRequestDetailDrawer.tsx                          (one pull request in full)
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
# first and RBAC-scoped: numbers only, never content. Work is attributed to a
# PROJECT, named by the person who owns it when the project is one person's
# workspace; the id an agent reports about its own user names nobody and is
# never shown.

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

  # The workload the feature is for: several agent worktrees on one branch,
  # folding within milliseconds of each other. Both the queue throttle and the
  # durable guard have to hold across sessions, not just within one.
  @integration @unit
  Scenario: Concurrent sessions on one branch ask GitHub once
    Given two sessions on the same repository and branch folding at the same time
    When both trigger the mapping
    Then GitHub is asked once
    And the second trigger is collapsed rather than queued as its own job

  @unit
  Scenario: Rechecks stop for branches with no recent session activity
    Given a branch whose sessions all ended more than a week ago
    When the periodic recheck selects branches
    Then that branch is not rechecked

  # The sweep is the one read in this feature with no organization to name, so
  # every replica running its own timer meant the whole fleet scanning the same
  # branches and asking GitHub about them N times.
  @unit
  Scenario: The recheck sweep runs once per fleet, not once per replica
    Given several workers reach the same recheck tick
    When the tick fires
    Then one sweep runs and the others stand down

  # Nothing removed a branch's bookkeeping or its pull requests, ever, at one
  # row per agent branch per repository.
  @unit
  Scenario: Linkage rows nobody asks about stop accumulating
    Given a branch outside the sweep's activity window
    When the retention prune runs
    Then its bookkeeping is removed
    And the pull requests it was the only reason to keep are removed
    And a reader asking again re-maps the branch from GitHub

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

  # A session records whatever casing the git remote carries, and a host is
  # case insensitive, so GitHub.com and github.com name one repository.
  @unit
  Scenario: A session whose remote host casing differs still finds its pull request
    Given a session whose remote host is spelled differently from the mapping's
    When sessions are assigned to pull requests
    Then it attaches to the same pull request as its lower case twin

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

  @unit
  Scenario: One repository reported with two host spellings stays one repository
    Given sessions on one repository whose remote host casing differs between them
    When the Pull Requests page lists it
    Then the repository appears once carrying all of its sessions
    And its pull requests are found under the mapping's own spelling

Rule: A personal row asks a personal question and answers with the organization's numbers

  # Which pull requests a person sees is a personal question: the ones their own
  # work touched. What each one COST is not, because a pull request is worked on
  # by whoever the organization put on it. Splitting the two is what stops the
  # page from reporting a fraction of a pull request as its whole price.

  @unit
  Scenario: A listed pull request counts every project the viewer may read
    Given a pull request whose sessions ran in the viewer's own project and a teammate's
    When the Pull Requests page lists it
    Then its sessions, tokens and cost cover both projects

  @unit
  Scenario: A project the viewer may not read is absent from the row and its totals
    Given a pull request with sessions in a project the viewer may not read
    When the Pull Requests page lists it
    Then that project's sessions are missing from the row
    And the row's totals equal the permitted sessions alone

  @unit
  Scenario: The viewer never chooses which projects are counted
    Given a caller asking for the pull request usage
    When the read resolves which projects to count
    Then the projects come from the caller's own permissions, never from the request

  @unit
  Scenario: Branches with no pull request stay the viewer's own work
    Given a branch with no pull request whose sessions ran in two projects
    When the Pull Requests page lists it
    Then the branch reports only the viewer's own sessions

  @unit @integration
  Scenario: A row names who worked on the pull request
    Given a pull request worked on by two contributors
    When the Pull Requests page lists it
    Then the row names each contributor once and how many sessions they ran

Rule: A contributor is a person or a project, never an agent-reported id

  # A session carries one per-person key, an id the agent reported about its own
  # user. It resolves to no account and to no human being, and one person's
  # agent can report a different one from run to run. So work is attributed to
  # the project it ran in: a personal workspace holds one person and is named by
  # them, a shared project is named by itself and opens its own traces. A split
  # by person WITHIN a shared project is deliberately not offered, because there
  # is no key that could honestly make it.

  @unit @integration
  Scenario: A personal workspace is named by the person whose work it is
    Given sessions that ran in someone's own workspace
    When the pull request usage is read
    Then the contributor is that person's name
    And the name opens nothing, because the workspace is theirs alone

  @unit @integration
  Scenario: A shared project is named by the project the work ran in
    Given sessions that ran in a project shared by a team
    When the pull request usage is read
    Then the contributor is the project's name
    And the name opens that project's traces

  @unit
  Scenario: One contributor and agent make one row, whatever the agent calls its user
    Given one contributor whose sessions report two different agent identities
    When the pull request usage is read
    Then they appear as one row per agent they used
    And no agent-reported identity appears anywhere in the answer

  @integration
  Scenario: A personal workspace resolves to the person who owns it
    Given a personal workspace whose only member has a name
    When the caller's project scope is resolved
    Then the workspace is named by that person
    And a shared project in the same organization is named by itself

  @integration
  Scenario: A person with no display name is named by their email address
    Given a personal workspace whose only member has no name
    When the caller's project scope is resolved
    Then the workspace is named by that member's email address

  @integration
  Scenario: A personal workspace nobody is a member of keeps its own name
    Given a personal workspace with no member
    When the caller's project scope is resolved
    Then the workspace is named by itself
    And the name still opens nothing

  # Members answer "who worked here" only where the answer is one person, and
  # reading them for every team would cost a query nothing displays.
  @integration
  Scenario: Members are read for personal teams alone
    Given an organization holding personal workspaces and shared projects
    When the caller's project scope is resolved
    Then members are read once, for the personal teams only

Rule: Token cost is split into what was billed and what was only theoretical

  # A coding assistant on a flat plan reports a list price its owner never paid.
  # The stored session carries one flat number, so the split is resolved at read
  # time from the same bundled-plan policy the receiver applies on ingestion.

  @unit
  Scenario: A bundled assistant's cost is reported as not billed
    Given a pull request whose sessions ran on an assistant covered by a bundled plan
    When the pull request usage is read
    Then the whole cost is reported as not billed
    And the grand total still reports the list price

  @unit
  Scenario: An assistant billed per token reports its cost as billed
    Given a pull request whose sessions ran on an assistant billed per token
    When the pull request usage is read
    Then the whole cost is reported as billed

  @unit
  Scenario: Two assistants on one pull request split its cost between them
    Given a pull request worked on by a bundled assistant and a per-token one
    When the pull request usage is read
    Then the bundled assistant's cost is not billed
    And the per-token assistant's cost is billed

  @unit
  Scenario: A viewer who may not price a project sees neither half of its cost
    Given a project the viewer may read but not price
    When the pull request usage is read
    Then the billed, not billed and grand totals are all absent for it

Rule: Each pull request reports what every model consumed

  @unit
  Scenario: The row reports each model's tokens and cost
    Given a pull request whose sessions called two models
    When the pull request usage is read
    Then each model reports its own input, output and cache tokens
    And each model reports what it cost

  @unit
  Scenario: A model's cost is absent when no permitted project may be priced
    Given a pull request in a project the viewer may read but not price
    When the pull request usage is read
    Then each model reports its tokens with no cost

  @integration
  Scenario: The per-model read is scoped to the tenant and to a bounded period
    Given per-call rows for two organizations sharing one session id
    When the per-model totals are read for one of them
    Then only that tenant's rows are counted
    And the read is bounded on the partition key

  @unit
  Scenario: Only model calls count toward the per-model totals
    Given a session whose events include tool runs and compactions
    When the per-model totals are read
    Then only the model calls contribute tokens

Rule: The pull request detail answers with facts and never with content

  @unit
  Scenario: The detail carries its contributors, models and sessions
    Given a pull request with sessions from several people
    When its detail is read
    Then it carries the totals, one row per contributor, the per-model totals and the sessions
    And the sessions are the most recent first

  @unit
  Scenario: The sessions list never carries a session title
    Given sessions with titles and transcripts
    When the pull request detail is read
    Then each session carries its start time, contributor, agent, tokens and cost only

Rule: The Pull Requests table compares a row against the page it is on

  @unit
  Scenario: Tokens and token cost each scale against their own p95
    Given visible rows whose token and cost ranks differ
    When the table draws its comparison bars
    Then each column scales against the p95 of its own values

  @unit
  Scenario: A row past the p95 is drawn as an outlier
    Given a row whose tokens exceed the visible p95
    When the table draws its comparison bar
    Then the bar fills completely and reads as an outlier

  @unit
  Scenario: Too few rows to compare draws no bars
    Given fewer than three rows carrying a value
    When the table draws its comparison bars
    Then no bar is drawn

  @unit
  Scenario: Millions of tokens read as millions
    Given a row of several million tokens
    When the count is formatted
    Then it reads in millions rather than thousands

  # One column, one way of reading it. Bundled money is the same list price as
  # any other, so setting it apart by color asked the reader to learn a legend
  # to read a number, and read as a different KIND of number rather than as the
  # same number with something more to say about it.
  @integration
  Scenario: A bundled token cost reads like every other token cost
    Given a row whose cost is partly not billed
    When the table draws its token cost
    Then the value is drawn exactly as a billed value is
    And its tooltip carries the billed and not billed split beside the page comparison

  @integration
  Scenario: Opening a pull request row opens its detail
    Given a listed pull request
    When the row is clicked
    Then the pull request detail opens for that pull request

  @integration
  Scenario: A branch with no pull request opens nothing
    Given a listed branch with no pull request
    When the row is clicked
    Then no detail opens

  @integration
  Scenario: A detail opened from its own address still finds its pull request
    Given a detail address carrying the pull request number as text
    When the detail is opened from that address
    Then the pull request is read by its number rather than refused

  @integration
  Scenario: A contributor named by a long name keeps the whole of it
    Given a contributor whose project carries a long name
    When the detail lists the contributors
    Then the name is cut to fit its column and stays available in full

  @integration
  Scenario: The table shows one page of pull requests at a time
    Given more pull requests than fit on a page
    When the page is changed
    Then the next pull requests are listed

  @integration
  Scenario: A page beyond the last one falls back rather than emptying the table
    Given a reader on the last page of pull requests
    When a refresh leaves fewer pull requests than that page starts at
    Then the table shows the last page that still has rows

  # The comparison is the only place a row's standing against its peers is
  # written down, so leaving it on hover alone would put it out of reach of
  # anyone reading without a pointer.
  @integration
  Scenario: A comparison is reachable without a pointer
    Given a page of pull requests carrying comparisons
    When the keyboard focus lands on a numeric column
    Then that column's comparison opens

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
  Scenario: The organization-wide read carries the cost split and the per-model totals
    Given a pull request with sessions on more than one model
    When the pull request usage is read for the organization
    Then every row and the totals carry the billed and not billed halves
    And the response carries the per-model totals
    And the pull request's own title stays out of the response

  @integration
  Scenario: An unmapped pull request returns the named failure
    Given a repository and pull request number no mapping knows
    When the pull request usage is read
    Then the caller receives the pull request not mapped failure

  # The answer names people, so who asked for it is written down. What the
  # record must NOT carry is the names themselves: an audit row outlives the
  # read, and copying the contributors into it would turn accountability into a
  # second place the same people are listed.
  @integration
  Scenario: A pull request usage read over the API is recorded
    Given a personal-workspace key reading a mapped pull request
    When the pull request usage is read
    Then the read is recorded against the caller, the organization and the pull request
    And the record says how many projects contributed without naming anyone

  # The rollup answers for a PERSON across the organization, so it needs one.
  # Both refusals carry a code rather than only a sentence, because the callers
  # are CLIs and agents that have to branch on the answer.
  @integration
  Scenario: A shared-workspace key cannot read pull request usage
    Given a key from a workspace that belongs to a team rather than one person
    When the pull request usage is read
    Then the refusal carries a named code saying a personal-workspace API key is required

  @integration
  Scenario: A key cannot read another user's pull request usage
    Given a key whose holder may view another user's personal workspace but does not own it
    When the pull request usage is read for that workspace
    Then the refusal carries a named code saying the key is for a different workspace
    And nothing in the refusal says whose workspace it is
