# Sessions lens, server-grouped session rollups on the traces list
#
# Implementation:
#   platform/app/src/server/app-layer/traces/repositories/session-groups.repository.ts            (row + cursor types, Null repo)
#   platform/app/src/server/app-layer/traces/repositories/session-groups.clickhouse.repository.ts (GROUP BY conversation id rollup)
#   platform/app/src/server/app-layer/traces/session-groups.service.ts                            (DTO mapping, cursor codec, coding-agent enrichment)
#   platform/app/src/server/api/routers/tracesV2.ts                                               (`sessions` procedure)
#   platform/app/src/features/traces-v2/hooks/useSessionGroups.ts                                 (lens data hook)
#   platform/app/src/features/traces-v2/components/TraceTable/ConversationLensBody.tsx            (session rows rendering)
#
# Related specs:
#   specs/traces-v2/grouping-engine.feature   , the by-conversation grouping this lens replaces the data source of
#   specs/traces-v2/lens-preset-groups.feature, preset lenses that sort sessions by cost/tokens/turns
#
# Motivation: the "Conversations" grouping used to group ONLY the fetched page
# of traces client-side, so every rollup (cost, tokens, duration, turn count)
# was silently truncated to the page. The Sessions lens keeps the same
# conversation-id grouping but computes TRUE rollups in ClickHouse: one row
# per session with total tokens, cost, trace count, context size, duration,
# models and last activity, a session ledger, priced. Session rows whose
# conversation id matches a coding-agent session are enriched with the
# pre-folded per-session counters (model calls, compactions, peak context).
#
# Decisions:
#   - Grouping key stays `gen_ai.conversation.id` (session id == conversation
#     id for coding agents); the persisted grouping mode key stays
#     "by-conversation" and every lens id keeps the name it was stored under,
#     while the labels a reader sees say "Conversations". "Sessions" names the
#     coding-agent sessions product, and one word cannot mean both surfaces.
#   - Rollups aggregate over the latest version of every trace in the time
#     range (IN-tuple dedup), never over one page.
#   - Free-text search ALSO matches session transcript content stored in
#     `log_records` (BodyText / flat attributes), so searching "#6418" finds
#     the session whose transcript mentions it even when no trace summary
#     column carries the text. That reach follows the viewer's content
#     protections: whether a session matches a term IS the content, so a
#     viewer who cannot read a transcript searches the trace columns only,
#     rather than probing the body one guess at a time.
#   - Keyset pagination over (sort value, conversation id); the cursor is an
#     opaque string so the sort dimension can change without breaking clients.

Feature: Sessions lens

Rule: Session rollups aggregate every trace of the session in range

  @integration
  Scenario: Session rollups sum every trace in the range, not one page
    Given two sessions whose traces carry costs, tokens and durations
    And one session has more traces than a single page
    When session groups are queried with a small page size
    Then each session row reports the sum over all of its traces
    And the trace count matches the total number of traces in the session

  @integration
  Scenario: A re-projected trace is only counted once in its session rollup
    Given a trace summary written twice with the same trace id and newer version
    When session groups are queried
    Then the session's trace count and cost reflect the latest version only

  @unit
  Scenario: Session rows map to the conversation group view model
    Given a session group payload from the sessions procedure
    When the payload is mapped for the sessions lens table
    Then totals, trace count, context size and last activity land on the row
    And coding-agent enrichment fills model calls and compactions when present

Rule: Free-text search also matches session transcript content

  @integration
  Scenario: Session content search matches transcript text in log records
    Given two sessions where only one has a log record mentioning "#6418"
    When session groups are queried with the content term "#6418"
    Then only the session whose transcript mentions "#6418" is returned

  @unit
  Scenario: A viewer who cannot read captured content cannot search it
    Given a viewer whose captured input or output is hidden
    When that viewer searches sessions for a term
    Then the term never reaches the transcript bodies

  @unit
  Scenario: A viewer with a hidden transcript category cannot search it
    Given a viewer for whom system or tool turns are hidden
    When that viewer searches sessions for a term
    Then the term never reaches the transcript bodies

  @unit
  Scenario: A viewer with a hidden custom attribute cannot search it
    Given a viewer with a custom attribute rule hidden from them, everything else visible
    When that viewer searches sessions for a term
    Then the term never reaches the transcript bodies

  @unit
  Scenario: A viewer allowed the whole transcript still searches it
    Given a viewer who may read captured content and every turn
    When that viewer searches sessions for a term
    Then the term is matched against the transcript bodies

Rule: A failed read is told as a failure, not as an empty result

  # Both lenses read through the same table shell, so this holds for the
  # session rollups and the flat trace list alike.
  @integration
  Scenario: A failed session read is not reported as an empty result
    Given the list query behind the active lens failed
    When the table renders
    Then the failure is shown instead of the no-results state

Rule: Session pages walk with a stable keyset cursor

  @integration
  Scenario: Session keyset pagination walks every session exactly once
    Given more sessions than one page
    When the caller walks pages using the returned cursor
    Then every session appears exactly once across pages
    And the rows arrive in descending last-activity order

  @unit
  Scenario: Session cursor encode and decode round-trip
    Given a session page cursor with a sort value, conversation id and sort
    When the cursor is encoded and decoded again
    Then the decoded cursor equals the original
    And decoding a malformed cursor is rejected

  @unit
  Scenario: A session cursor from another sort is refused
    Given a session page cursor minted while sorting by cost
    When the same cursor is replayed against a last-activity sort
    Then the read is refused with a validation error
    And the repository is never queried

  @unit
  Scenario: Switching lenses does not carry a cursor across
    Given the list is on its second page
    When the reader switches to a lens that pages differently
    Then the new lens starts at its own first page
    And the previous lens's cursor is not offered to it

  @integration
  Scenario: A larger persisted page size clamps to the sessions cap
    Given the shared rows-per-page preference is larger than the sessions lens allows
    When a page of sessions is paginated
    Then the range copy counts by the clamped page size
    And page sizes beyond the cap are not offered

Rule: Coding-agent session rows enrich the rollup

  @unit
  Scenario: Coding agent enrichment attaches model calls and compactions
    Given a session whose conversation id matches a coding-agent session row
    When session groups are assembled by the service
    Then the session carries model calls, compactions, peak context tokens and sub agents
    And sessions without a coding-agent row keep the enrichment empty

  @unit
  Scenario: Coding agent enrichment carries repository, branch, worktree and title
    Given a coding-agent session row with git context and a title
    When session groups are assembled by the service
    Then the session carries the repository, branch, worktree and title
    And sessions without git context keep those fields empty

Rule: The session title follows the viewer's content protections

  @unit
  Scenario: A viewer who cannot read captured content sees no session title
    Given a session with a title and a viewer whose captured content is hidden
    When the session page is gated for that viewer
    Then the title is stripped and marked as redacted

  @unit
  Scenario: A viewer with full content visibility sees the title verbatim
    Given a session with a title and a viewer who may read captured content
    When the session page is gated for that viewer
    Then the title survives unchanged

  @unit
  Scenario: A session beyond the visibility window teases its title
    Given a session older than the plan's visibility window
    When session groups are assembled by the service
    Then the title is teased the same way the previews are

Rule: Sessions link to their repository and pull request

  @unit
  Scenario: The sessions lens offers repository and pull request columns
    Given session rows enriched with a repository and a mapped pull request
    When the sessions lens renders with those columns enabled
    Then the repository column shows the owner and name
    And the pull request column links the pull request number

  @unit
  Scenario: A session with a visible title shows it as its label
    Given a session row whose title is present and not redacted
    When the sessions lens renders the session cell
    Then the title is the session's label
    And a session without a title keeps today's label

Rule: The sessions lens renders true totals

  @unit
  Scenario: The sessions lens renders server rollup totals
    Given the sessions lens is active with server-grouped session rows
    When the table renders
    Then the row shows the session's total traces, tokens, cost and last activity
    And the totals come from the server rollup, not the fetched trace page

  @unit
  Scenario: An expanded session says how much of it the turn list shows
    Given an expanded session holding more traces than the turn preview loads
    When the expanded summary renders
    Then it reports how many of the session's traces are listed
    And a session whose turns are all loaded reports the plain total

Rule: A conversation row opens its most recent trace

  # The rollup is a GROUP BY, so the row names no trace on its own. Carrying
  # the session's newest trace id alongside the totals is what lets a click on
  # the row land somewhere: the reader's first question about a conversation is
  # almost always "what just happened in it".

  @integration
  Scenario: The rollup names each session's most recent trace
    Given a session whose traces were captured at different times
    When session groups are queried
    Then the session row carries the trace id of its latest trace

  @unit
  Scenario: The session read carries the latest trace id onto the row
    Given a session group row naming its latest trace
    When session groups are assembled by the service
    Then the session carries that trace id

  @integration
  Scenario: Clicking a conversation opens its latest trace in the drawer
    Given the conversations lens is showing grouped rows
    When the reader clicks a conversation row
    Then the trace drawer opens on the conversation's most recent trace
    And the row does not expand

  @integration
  Scenario: The chevron alone expands a conversation inline
    Given the conversations lens is showing grouped rows
    When the reader clicks the row's expand chevron
    Then the conversation expands inline
    And the trace drawer stays closed

Rule: A conversation row counts only in words

  @integration
  Scenario: A conversation row carries no bare icon counters
    Given a conversation row rolling up many spans
    When the row renders
    Then no number is shown against an icon with nothing naming it
    And the expanded summary still says how many spans the conversation holds

Rule: Session spend follows the viewer's cost permission

  @unit
  Scenario: A viewer without cost:view sees no session spend
    Given a page of session rows carrying rolled-up cost
    When the page is gated for a viewer who may not view costs
    Then every session's total cost is stripped
    And a viewer who may view costs keeps the spend
