Feature: PR token usage comment
  As a reviewer
  I want a single comment stating what the coding agents spent on a pull request
  So that the cost of the work is visible next to the work itself

  The data comes from the LangWatch pull-request usage API
  (GET /api/v1/coding-agent/pull-request-usage), which rolls a pull request's
  whole lifetime up into sessions, tokens and cost per contributor and agent.
  The workflow only reads and comments: it never gates a merge.

  Background:
    Given the pr-token-usage workflow runs on pull_request events
    And it identifies its own comment by the hidden marker "<!-- pr-token-usage -->"

  Scenario: A comment is posted when usage exists for the pull request
    Given LangWatch has recorded sessions for the pull request
    When the workflow runs
    Then a comment carrying the usage marker is posted exactly once

  Scenario: The existing comment is updated when new commits are pushed
    Given a pull request already has a comment carrying the usage marker
    When a new commit is pushed to the pull request branch
    Then the existing comment is updated in place
    And no additional comment is created

  Scenario: A pull request with no attributed usage still gets a comment
    Given LangWatch has no sessions attributed to the pull request
    When the workflow runs
    Then a comment carrying the usage marker is posted
    And it states that no usage was attributed
    And staying silent is not an option, because a broken pipeline would then
      look exactly like a pull request nobody used an agent on

  @unit
  Scenario: An empty report says what to check
    Given a rollup with no sessions
    When the comment body is built
    Then the comment names the telemetry wiring, the declared checkout and the
      agent as the things to check
    And the guidance is folded, so an empty report costs one line
    And a comment with usage carries no such guidance

  Scenario: An existing comment is refreshed even when usage drops to zero
    Given a pull request already has a comment carrying the usage marker
    And LangWatch now reports no sessions for the pull request
    When the workflow runs
    Then the existing comment is updated rather than left stale

  Scenario: A LangWatch outage never blocks the pull request
    Given the LangWatch API is unreachable or answers with an error
    When the workflow runs
    Then the workflow logs a warning and succeeds
    And no comment is created or modified

  Scenario: Pull requests from forks are skipped
    Given a pull request originates from a forked repository
    When the workflow is triggered
    Then no comment is attempted
    And the workflow does not fail

  @unit
  Scenario: A manual refresh reports the pull request's own head commit
    Given a manual refresh names a pull request number and nothing else
    When the pull request is read
    Then the commit named in the comment is the pull request's head commit
    And never the branch the refresh was dispatched from

  @unit
  Scenario: A manual refresh still refuses a fork pull request
    Given a manual refresh names a pull request whose head branch is in another repository
    When the pull request is read
    Then it is treated as a fork and no comment is attempted
    And a pull request whose fork was deleted is treated the same way

  @unit
  Scenario: The whole comment listing is searched for the marker
    Given a pull request carries more comments than one listing page holds
    When the next page is read from the Link header
    Then the search follows every page until the listing ends
    And the marker is never missed into a duplicate comment

  Scenario: Rapid successive pushes do not create duplicate comments
    Given a pull request receives two pushes in quick succession
    When both workflow runs are triggered
    Then the earlier run is cancelled before it posts
    And the pull request carries exactly one usage comment

  @unit
  Scenario: The comment shows one row per contributor and agent
    Given a usage rollup with rows for two contributors
    When the comment body is built
    Then each contributor appears once with its agent, sessions, tokens and cost
    And a totals row sums them

  @unit
  Scenario: The comment carries a per-model breakdown
    Given a usage rollup with a model breakdown
    When the comment body is built
    Then each model's tokens and cost appear in a collapsed details section

  @unit
  Scenario: Costs the caller may not price render as unavailable
    Given a usage rollup whose cost fields are null
    When the comment body is built
    Then the cost cells render as an em dash rather than zero

  @unit
  Scenario: Token counts render as words
    Given a usage rollup with a token count above one billion
    When the comment body is built
    Then the count renders as a spelled-out magnitude such as "2.6 billion"
    And the unit is a word, never a letter abbreviation
    And a count below one thousand stays a plain number

  @unit
  Scenario: Agent identifiers render as product names with their icons
    Given a usage row whose agent is "claude_code"
    When the comment body is built
    Then the agent renders as "Claude Code" beside its product icon
    And an unknown agent identifier falls back to a readable form of itself, without a broken image

  @unit
  Scenario: A gap between session totals and per-model rows is called out
    Given a usage rollup whose model rows cover far fewer tokens than the totals
    When the comment body is built
    Then a note states how many of the total tokens the model rows cover
    And a rollup whose model rows match the totals carries no such note

  Rule: A merged pull request is refreshed one last time

    The per-pull-request workflow refreshes on every push, so the last comment
    describes the world as it was at the last commit. Review agents keep
    reading the diff after that, and a pull request approved as it stands
    never gets another push. A merge is the moment the total stops moving.

    Scenario: The comment is refreshed when the pull request merges
      Given a pull request carries a usage comment
      And no further commit is pushed to it
      When the pull request is merged
      Then its comment is refreshed a final time
      And the tokens spent reviewing it after its last commit are included

    @unit
    Scenario: The last refresh says the number is settled
      Given a pull request that has merged
      When its comment is refreshed one last time
      Then the comment states that the total is final at the merge commit
      And a comment on an open pull request keeps the ordinary stamp

    @unit
    Scenario: A merged pull request gets one last refresh
      Given a push to the default branch that merged a pull request
      When the pull requests for the pushed commit are read
      Then the pull request that merged into the pushed branch is named

    @unit
    Scenario: Only the pull requests that merged are refreshed
      Given a commit associated with pull requests that did not merge it
      When the pull requests for the pushed commit are read
      Then open pull requests are passed over
      And pull requests merged into another branch are passed over

    @unit
    Scenario: A batch merge refreshes every pull request it carried
      Given a push to the default branch that merged more than one pull request
      When the pull requests for the pushed commit are read
      Then every merged pull request is named exactly once

    @unit
    Scenario: Every commit in the push is resolved, not just the tip
      Given a push that landed more than one commit
      When the commits to resolve are chosen
      Then every commit in the push is resolved
      And no pull request merged earlier in the push is left behind

    @unit
    Scenario: A pull request is stamped with the commit it landed on
      Given a pull request whose commits all landed in this push
      When the landing commit for each pull request is chosen
      Then the last of its commits is named, never the first

    @unit
    Scenario: Each pull request in a batch keeps its own commit
      Given a push that carried more than one pull request
      When the landing commit for each pull request is chosen
      Then each pull request is stamped with the commit that carried it
      And never with the whole push's tip

    @unit
    Scenario: A push with no comparable range still resolves its tip
      Given a push that created the branch, or a range that could not be read
      When the commits to resolve are chosen
      Then the push tip alone is resolved
      And the job does not fail

    @unit
    Scenario: A merged fork pull request is still not commented on
      Given a merged pull request whose head branch is in another repository
      When the pull requests for the pushed commit are read
      Then it is reported as a fork rather than refreshed

    @unit
    Scenario: A push that merged nothing changes nothing
      Given a direct push to the default branch
      When the pull requests for the pushed commit are read
      Then no pull request is named and no comment is touched

  @unit
  Scenario: An unmapped pull request reads as no usage
    Given the LangWatch API answers that the pull request is not mapped
    When the response is interpreted
    Then it is treated as "no usage recorded" rather than an error
