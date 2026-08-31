# Pull request linkage, sessions mapped to GitHub pull requests and priced
#
# Implementation:
#   platform/app/src/server/app-layer/github/github-pull-request-mapping.service.ts   (branch-to-PR mapping + negative cache)
#   platform/app/src/server/app-layer/github/githubPullRequestEvent.ts                 (the pull_request webhook payload, validated)
#   platform/app/src/server/routes/github.ts                                           (the webhook delivery target)
#   platform/app/src/server/app-layer/github/github-pull-request-status.service.ts    (live status, Redis-cached, never the queue)
#   platform/app/src/server/event-sourcing/pipelines/coding-agent-processing/subscribers/pullRequestMapping.subscriber.ts (fold trigger)
#   platform/app/src/server/app-layer/coding-agent/pull-request-assignment.ts          (session-to-PR tenure rule)
#   platform/app/src/server/app-layer/coding-agent/pull-request-usage.service.ts       (org-first usage rollup)
#   platform/app/src/server/app-layer/coding-agent/coding-agent-source-type.ts         (agent id to ingestion source type)
#   platform/app/src/server/app-layer/coding-agent/repositories/coding-agent-session-events.repository.ts (per-model totals)
#   platform/app/src/server/organizations/resolveCallerProjectScope.ts                 (the caller's permission cut and how each project is named, shared by both read surfaces)
#   platform/app/src/app/api/coding-agent/[[...route]]/                                (the usage REST endpoint)
#   platform/app/src/pages/me/pull-requests.tsx                                        (the personal Pull Requests page)
#   platform/app/src/components/me/PullRequestsTable.tsx                               (the table)
#   platform/app/src/components/me/PullRequestDetailDrawer.tsx                          (one pull request in full)
#   platform/app/src/components/me/PullRequestStatusBadge.tsx                           (a status drawn the way GitHub draws it)
#   platform/app/src/components/me/usePullRequestSort.ts                                (the table's order, and the way back to it)
#   platform/app/src/components/me/AgentLabel.tsx                                       (an assistant named like its product)
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
# first and RBAC-scoped, and carries numbers only. The DETAIL read adds the
# one-line title a session generated for itself, which travels under the content
# visibility of the project that session ran in and is the only content on that
# surface. Work is attributed to a
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

  @unit
  Scenario: A repository on a host this instance cannot answer for never triggers a GitHub call
    Given a session whose repository host is not the instance's GitHub host
    When the mapping trigger evaluates the session
    Then no mapping is requested

  @integration
  Scenario: Connecting GitHub backfills recent branches
    Given sessions with repo and branch folded before any GitHub connection existed
    When the organization connects GitHub
    Then the recent branches are mapped without waiting for new sessions

Rule: Demand is what a session asks for, and only demand keeps a branch in the sweep

  # The column the sweep selects on was also written by the sweep itself, so a
  # branch that never gets a pull request renewed its own place in the sweep and
  # was asked about every day for as long as the connection existed.
  @integration
  Scenario: The sweep does not renew the demand it selects on
    Given a branch with no pull request that the sweep asks GitHub about
    When the sweep records the empty answer
    Then the branch's last demand time is unchanged

  @integration
  Scenario: A session folding on a branch records demand for it
    Given a branch with no pull request
    When a session folds on that branch and the mapping runs
    Then the branch's last demand time moves to the time of the fold

  @integration
  Scenario: A branch with no session demand for a week leaves the sweep
    Given a branch whose last session demand is older than the activity window
    When the periodic recheck selects branches
    Then that branch is not selected

Rule: Bookkeeping is pruned, and the pull requests it found are kept

  # One bookkeeping row per agent branch per repository, and nothing removed
  # them, so the table grew for as long as the connection existed.
  @integration
  Scenario: Bookkeeping for a branch outside the activity window is removed
    Given a branch outside the sweep's activity window
    When the retention prune runs
    Then its bookkeeping is removed
    And a session folding on that branch again re-maps it from GitHub

  # A pull request is a record of work that was done. Removing it when the
  # branch went quiet took merged work off the Pull Requests page, which is the
  # work people most want to look back at.
  @integration
  Scenario: A linked pull request stays after its branch goes quiet
    Given a branch outside the sweep's activity window whose pull request is linked
    When the retention prune runs
    Then the pull request is still stored for the organization

Rule: A pull request links itself the moment GitHub announces it

  # Polling alone linked a branch up to a day after its pull request was
  # opened, because a branch is at its most backed-off exactly when the pull
  # request finally appears: people and coding agents branch first, work for
  # hours, and open the pull request last.
  @integration
  Scenario: A pull request opened on a branch is linked without waiting for a recheck
    Given an organization whose GitHub connection covers a repository
    And a branch with no pull request yet
    When GitHub announces that a pull request was opened for that branch
    Then the pull request is stored for the branch straight away
    And GitHub is not asked to list the branch's pull requests

  @integration
  Scenario: The announcement clears the branch's backoff
    Given a branch whose repeated empty answers armed the longest backoff
    When GitHub announces a pull request for that branch
    Then the branch is no longer waiting to be asked again
    And a later empty answer arms the shortest backoff rather than the longest

  @integration
  Scenario: A pull request that merges is announced as merged
    Given a stored pull request that is open
    When GitHub announces that it was merged
    Then the stored pull request reads as merged

  @unit
  Scenario: An announcement for a connection this instance does not hold is dropped
    Given an announcement carrying an installation with no local record
    When it arrives
    Then nothing is stored for it

  @unit
  Scenario: An announcement that changes nothing the page shows is dropped
    Given an announcement that a label was added to a pull request
    When it arrives
    Then nothing is written

  # The head of a pull request from a fork lives in another repository, which
  # is a repository a session on this one never names.
  @unit
  Scenario: An announcement for a pull request opened from a fork is dropped
    Given an announcement whose head branch lives in a different repository
    When it arrives
    Then nothing is stored for it

  @integration
  Scenario: Every announcement is acknowledged, applied or not
    Given a signed announcement this instance has nothing to do with
    When GitHub delivers it
    Then GitHub is told the delivery succeeded

  @integration
  Scenario: A redelivered announcement changes nothing
    Given an announcement that has already been applied
    When GitHub delivers it a second time
    Then the branch still carries exactly one pull request, unchanged

  # GitHub does not promise the order it delivers announcements in, and a
  # pull request's close and merge times are what decide which sessions are
  # priced under it. A late announcement written over a newer one reopens a
  # merged pull request and takes the sessions that ran after it closed.
  @integration
  Scenario: A late delivery about an earlier state does not roll the pull request back
    Given a pull request stored as merged
    When an announcement about its earlier state arrives after the merge
    Then the pull request still reads as merged
    And its close and merge times are unchanged
    And its title is not put back to the earlier one

  @integration
  Scenario: A listing that answers after a newer announcement does not roll it back
    Given a listing of a branch's pull requests still waiting on GitHub
    When the pull request is announced as merged before the listing answers
    Then the listing's older answer leaves the stored pull request as merged

  # Deliveries get missed, installations get suspended and resumed, and a
  # self-hosted instance may never be reachable by GitHub at all. The recheck
  # is the floor under the announcement, not something it replaces.
  @integration
  Scenario: A branch whose announcement never arrived is still linked by the recheck
    Given a pull request opened for a branch and no announcement delivered
    When the periodic recheck runs after the branch's backoff elapses
    Then the pull request is linked

Rule: A branch a session just ran on is asked about again soon

  # The backoff grew on the theory that a branch empty four times is a branch
  # whose work never became a pull request. A session folding on that branch is
  # the plainest evidence to the contrary, so it brings the next question
  # forward instead of inheriting a day-long wait.
  @integration
  Scenario: A new session on a branch brings its next question forward
    Given a branch sitting on the longest backoff with no pull request
    When a coding-agent session folds on that branch
    Then the branch is due to be asked about again within the shortest backoff

  @integration
  Scenario: Repeated folds on one branch still ask GitHub once per backoff
    Given a branch a session just folded on and asked GitHub about
    When more sessions fold on it before the backoff elapses
    Then GitHub is not asked again

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
  Scenario: The page rolls up tokens and cost per pull request
    Given mapped pull requests with sessions attached across their lifetimes
    When the pull request usage is read for the caller's project
    Then each pull request reports its tokens and assistant cost
    And the figures cover the pull request's lifetime, not a time picker window

  # One session often drives several pull requests: it lands a change, moves to
  # the next branch and opens another. Reading a pull request's price off the
  # branch a session ENDED on charges the whole session to its last pull request
  # and leaves the earlier ones looking free.

  @integration
  Scenario: A session that moved to another branch is still read for the branch it left
    Given a session that worked on one branch and then moved to another
    When the sessions of the first branch are read
    Then that session is among them

  @unit
  Scenario: A session that moved to another branch counts toward the pull request it drove first
    Given a session that drove a pull request's branch and then moved to another
    When that pull request's usage is read
    Then the session's tokens and cost are counted toward it

  @unit
  Scenario: The personal page discovers pull requests from every branch a session drove
    Given a session that drove two branches
    When the personal pull requests are read
    Then the pull requests of both branches are looked up

  # A session records one set of token and cost totals for its whole life and
  # the per-call facts carry no branch, so there is nothing to divide between
  # two pull requests. Counting the whole session toward each one would make a
  # repository's pull requests sum to more than was ever spent. The sessions
  # screen is where all of a session's pull requests are shown.

  @unit
  Scenario: A session that drove two pull requests counts toward only one of them
    Given a session that drove two branches, each with a live pull request
    When the tenure rule is asked
    Then the session counts toward the pull request it opened first
    And it counts toward the other one not at all

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

  # The row is where the reader notices the gap, so it is where the fix is
  # offered: sending them to a settings page to find out what was missing puts
  # the answer two navigations away from the question.
  @integration
  Scenario: An uncovered repository invites linking right on its row
    Given a listed branch whose repository no installation covers
    When an organization manager reads the row
    Then the invitation to link that repository sits on the row itself
    And a member without that permission finds it disabled, and is told to ask an administrator
    And choosing the disabled invitation opens nothing

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
  Scenario: The drawer names who worked on the pull request
    Given a pull request worked on by two contributors
    When the reader opens its detail
    Then the detail names each contributor once and how many sessions they ran

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

  # The schema has no foreign keys, so a membership row can outlive its user.
  @integration
  Scenario: A membership row that outlives its user still resolves the scope
    Given a personal workspace whose membership row points at a deleted user
    When the caller's project scope is resolved
    Then the read does not fail
    And the workspace is named by itself

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

  # The per-call totals and the session's own record of which models it ran are
  # written by different carriers, so a session can have one and not the other.
  # A row that plainly ran a model must never report that it ran none.

  @unit
  Scenario: A pull request reports its models even without per-call data
    Given a pull request whose sessions recorded their models but logged no model calls
    When the pull request usage is read
    Then the row names those models
    And the row reports no per-model tokens

  @unit
  Scenario: Per-call model data wins over the recorded names
    Given a pull request whose sessions both recorded their models and logged model calls
    When the pull request usage is read
    Then the row reports each model's tokens rather than names alone

  @integration
  Scenario: The detail names the models even without per-call data
    Given a pull request whose sessions recorded their models but logged no model calls
    When the detail is opened
    Then the models section names them instead of saying there is no model data

  @unit
  Scenario: A branch rollup carries the models its sessions ran
    Given a branch with no pull request whose sessions recorded two models
    When the personal usage is read
    Then the branch rollup names both of them

  @unit
  Scenario: A branch whose sessions recorded no model reports none
    Given a branch with no pull request whose sessions recorded no model
    When the personal usage is read
    Then the branch rollup names no model

  @integration
  Scenario: A branch row reports the models its sessions ran
    Given a listed branch whose sessions ran two models
    When the table is read
    Then the row names the leading model and counts the rest

  @unit
  Scenario: A row with only model names sorts by them
    Given rows whose models come from per-call totals and from recorded names
    When the table is sorted by model
    Then both kinds of row take their place by the model they name

Rule: The pull request detail answers with facts, and names its sessions

  @unit
  Scenario: The detail carries its contributors, models and sessions
    Given a pull request with sessions from several people
    When its detail is read
    Then it carries the totals, one row per contributor, the per-model totals and the sessions
    And the sessions are the most recent first

  # A session's title is the one thing that tells two of a person's sessions
  # apart, and a detail that lists three anonymous rows makes the reader open
  # each one to find out which is which. It is conversation-derived content, so
  # it travels under the same content visibility every other session surface
  # applies, resolved per contributing project: a reader may be trusted with
  # one project's conversations and not another's, and the detail spans both.

  @unit
  Scenario: The sessions list names each session by its generated title
    Given a pull request whose sessions generated titles
    When the pull request detail is read
    Then each session carries its title alongside its start time, contributor, agent, tokens and cost

  @unit
  Scenario: A session whose project hides captured content is listed without its title
    Given a pull request with sessions from a project whose captured content this reader may not see
    When the pull request detail is read
    Then that project's sessions carry no title
    And the sessions of a project the reader may read keep theirs

  @integration
  Scenario: The drawer names each session by its title, or says it has none
    Given a pull request whose sessions include one with a title and one without
    When the detail is read
    Then the titled session is named by its title
    And the untitled one is named as an untitled session

  # A reader knows their assistants by the names their makers gave them, not by
  # the spelling that happened to arrive on the wire.
  @integration
  Scenario: The detail names each agent like its product, with its mark
    Given a pull request worked on by two different assistants
    When the detail lists them
    Then each is named the way its own product is named
    And each name carries that assistant's mark

  @unit
  Scenario: An agent slug resolves to its product name
    Given the name an assistant reported for itself
    When it is resolved for a reader
    Then it reads as the product's own name rather than as the reported spelling

  @integration
  Scenario: The detail's GitHub button opens the pull request in a new tab
    Given an open pull request detail
    When its GitHub button is chosen
    Then the pull request opens on GitHub in a new tab
    And the detail stays where it was

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

Rule: The table reads a pull request's status the way GitHub writes it

  # A reader arrives here from GitHub and goes straight back to it, so a status
  # they already know by its color should not have to be learned twice. Merged
  # is purple, open is green, closed is red and a draft is gray, the same four
  # answers, drawn the same way, on both sides of the trip.

  @integration
  Scenario: A pull request's status carries GitHub's own color and mark
    Given a merged, an open, a closed and a draft pull request
    When the table shows their status
    Then merged is purple and carries the merge mark
    And open is green, closed is red and draft is gray
    And each is drawn solid rather than as an outline

  @unit
  Scenario: The stored snapshot derives merged, closed, draft and open
    Given stored pull requests that were merged, closed without merging, left in draft and left open
    When each row's status is derived from what was stored
    Then the merged one reads merged and the closed one reads closed
    And the draft one reads draft and the last one reads open

  # Waiting for GitHub to leave the whole column blank would make the page look
  # broken for as long as the round trip takes, and the stored answer is right
  # for almost every row almost all of the time.
  @integration
  Scenario: A status shows from the stored snapshot before GitHub answers, and the live answer takes over
    Given a listed pull request whose live status has not arrived yet
    When the table draws its status
    Then the stored snapshot's status is shown straight away
    And the live answer replaces it once GitHub responds

  @integration
  Scenario: A branch with no pull request says No PR yet in the status column
    Given a listed branch with no pull request
    When the table draws its status
    Then the status column says No PR yet
    And nothing about it reads as a pull request state

  @integration
  Scenario: The detail tells the same status story as the list
    Given a listed pull request drawn with its status
    When its detail is opened
    Then the detail reports the same status, drawn the same way

Rule: The table lists the most recently active work first

  # "Last update" is our own answer rather than GitHub's: it is when the work
  # this page prices last ran. A pull request nobody has pushed to in a week can
  # still have had a session on it this morning, and that session is the reason
  # the reader came.

  @unit
  Scenario: A pull request's last update is the latest session across every counted project
    Given a pull request whose sessions ran in the viewer's own project and a teammate's
    When the Pull Requests page lists it
    Then its last update is the most recent of all of those sessions
    And a session that started earlier but kept running later counts by when it last ran

  @unit
  Scenario: A branch's last update is the latest of its own sessions
    Given a branch with no pull request whose sessions ran at different times
    When the Pull Requests page lists it
    Then its last update is the most recent of the viewer's own sessions on it
    And a teammate's session elsewhere does not move it

  @unit
  Scenario: Rows order by their last update by default, pull requests and branches together
    Given listed pull requests and branches with no pull request
    When the table is first drawn
    Then the rows read most recently updated first
    And a branch takes its place among the pull requests rather than after them

  @unit
  Scenario: A recent update reads as time ago and an older one as a date
    Given a row updated hours ago and a row updated months ago
    When the table draws their last update
    Then the recent one reads as how long ago it was
    And the older one reads as its date

Rule: Every column sorts, and sorting always has a way back

  # A reader who cannot undo a sort has to guess which column the page opened
  # on, so the third click is what makes trying the first one free.

  @unit
  Scenario: A numeric column sorts largest first on the first click
    Given a page of rows carrying numbers
    When a numeric column's heading is chosen
    Then the largest value leads

  @unit
  Scenario: A text column sorts A to Z on the first click
    Given a page of rows carrying names
    When a text column's heading is chosen
    Then the names read A to Z

  @unit
  Scenario: A second click flips the order and a third returns to the default
    Given a column the reader has already sorted
    When its heading is chosen twice more
    Then the second choice reverses the order
    And the third leaves the table in the order it opened in

  @unit
  Scenario: Status sorts by the stored snapshot and branches rank last
    Given listed pull requests in different states and a branch with no pull request
    When the status column is sorted
    Then the pull requests order by the status that was stored for them
    And the branch with no pull request comes last, whichever way the column is sorted

  @integration
  Scenario: Sorting is operable from the keyboard and announced to assistive readers
    Given a page of pull requests
    When the keyboard focus lands on a column heading
    Then that column can be sorted without a pointer
    And the column being sorted and the direction it is sorted in are both announced

Rule: The list narrows by search and by period

  @integration
  Scenario: Search matches number, title, branch and repository regardless of case
    Given listed rows differing in number, title, branch and repository
    When a search term is typed in any casing
    Then every row matching it on any of those four stays listed
    And the rest leave the list

  @integration
  Scenario: A period keeps only rows whose last update falls inside it
    Given rows last updated at different times
    When a period is chosen
    Then only the rows last updated inside it are listed

  # The page prices whole pull request lifetimes, so opening it on a window
  # would hide the long-lived ones and understate the ones it still showed.
  @integration
  Scenario: The period starts at all time and can return to it
    Given the Pull Requests page as it first opens
    When the period is read
    Then it covers all time
    And a narrower period can be widened back to all time

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

# The question is organization-wide, so the v1 door authenticates at the
# organization: an sk-lw user-bound key alone, with no project named anywhere.
# The personal-workspace indirection on the legacy path existed only to recover
# the calling user, which the key itself already carries.
Rule: The v1 usage read needs only an organization credential that names its user

  @integration
  Scenario: An organization key reads pull request usage without naming a project
    Given a user-bound organization API key
    When the v1 pull request usage is read with no project id anywhere in the request
    Then the answer is the caller's organization-wide rollup
    And the read is recorded against the caller, the organization and the pull request

  # A key can carry bindings NARROWER than its holder's own — that ceiling is
  # the whole point of a restricted key — so the rollup intersects the
  # holder's cut with the key's, the same key-plus-holder decision every
  # other REST door asks.
  @integration
  Scenario: A narrowed key reads with its own scope, not its holder's
    Given a holder who may view traces in two projects
    And their organization key is bound to only one of them
    When the v1 pull request usage is read with that key
    Then only the bound project's rows appear
    And the other project is absent from the whole answer

  @integration
  Scenario: A key whose binding lacks the cost grant reads tokens with no cost
    Given an organization key bound to one project with a role that cannot price
    When the v1 pull request usage is read with that key
    Then the bound project's rows carry token counts
    And every cost in the answer is absent

  # An organization service key authenticates fine but answers for nobody:
  # the rollup is the CALLER's permission cut, and a key with no user has no
  # caller to cut by. Refused with its own stable code, not a generic 401.
  @integration
  Scenario: An organization key with no bound user cannot read pull request usage
    Given an organization API key created without a user
    When the v1 pull request usage is read
    Then the refusal carries a named code saying a user-bound API key is required

  # A legacy project key carries no organization and no user, so it cannot
  # authenticate at the organization door at all. The refusal names the
  # credential class to swap, because the caller is holding a working key of
  # the wrong family, not a typo.
  @integration
  Scenario: A legacy project key cannot reach the v1 usage read
    Given a legacy project API key
    When the v1 pull request usage is read
    Then the refusal carries the credential class mismatch code
    And the refusal names the organization key as the class this door needs

  # The mapping is per organization, so another organization's key holds no
  # question this instance can answer for that pull request — and learning
  # whether the mapping exists elsewhere is not its to learn.
  @integration
  Scenario: An organization key from another organization learns nothing
    Given a user-bound organization API key from a different organization
    When the v1 pull request usage is read for a pull request mapped elsewhere
    Then the caller receives the pull request not mapped failure
    And nothing says the pull request is mapped for anyone else
