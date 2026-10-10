# The working context a coding-agent session declares, and what it charges
#
# Implementation:
#   modules/coding-agent/contract/src/telemetry/session-context.ts                      (the declaration's vocabulary and the stamp)
#   modules/coding-agent/process/src/services/contribute-log-facts.service.ts           (remembers a declaration, stamps row-bearing records)
#   modules/coding-agent/process/src/services/contribute-span-facts.service.ts          (stamps the spans that carry a model call)
#   modules/coding-agent/process/src/eventing/coding-agent-session-state.projection.ts  (chargeContextUsage, the bound)
#   modules/coding-agent/process/src/eventing/coding-agent-session.projection.ts        (the row column, both ways)
#   packages/clickhouse-migrations/migrations/00099_coding_agent_sessions_usage_by_context.sql
#
# Only the charging rule is written here. The memo's own lifetime and the
# declaration command live in specs/ai-governance/cli-wrappers/session-context-declare.feature.

Feature: A session's usage is charged to the context it declared

Rule: Tokens are charged to the context declared before them

  # The per-call fact table only sees the agents whose tokens ride log
  # records. Codex reports its tokens on the turn span and so contributes no
  # fact row at all, which left its sessions with nothing to split by: a
  # long-lived Codex session declaring a new branch per pull request was
  # charged whole to whichever pull request the read looked at. So the span
  # that carries a model call is stamped the same way a row-bearing log
  # record is, and the session fold keeps, next to its cumulative totals, what
  # was spent under each stamped context. The row is the ledger the split
  # reads; the fact table stays the model breakdown's source.

  @unit
  Scenario: A model-call span after a declaration carries the declared context
    Given a session that declared a repository and branch
    When a model-call span is contributed after it
    Then the contribution carries that repository and branch

  @unit
  Scenario: A model-call span before any declaration is contributed unstamped
    Given a session that has not declared a working context
    When a model-call span is contributed
    Then the contribution carries no repository and no branch

  @unit
  Scenario: A span that carries no tokens is not stamped
    Given a session that declared a repository and branch
    When a tool span is contributed after it
    Then the contribution carries no stamped context

  @unit
  Scenario: A model call's tokens and cost are charged to the context stamped on it
    Given a session whose model calls are stamped with two different branches
    When the session fold runs
    Then the row records each branch's own tokens and cost
    And the session's cumulative totals are the sum of both

  @unit
  Scenario: A model call with no stamp is charged to no context
    Given a session whose model call carries no stamped context
    When the session fold runs
    Then the row records no per-context usage for it
    And the session's cumulative totals still count it

  @unit
  Scenario: The per-context usage record stops growing at its bound
    Given a session whose model calls are stamped with more contexts than the record holds
    When the session fold runs
    Then the record keeps the first contexts it saw and no more
    And the session's cumulative totals still count every call

  @unit
  Scenario: The per-context usage survives the row and rebuilds identically
    Given a session that charged usage to two contexts
    When the session fold writes its row and the state is rebuilt from it
    Then the rebuilt state carries the same per-context usage

  @integration
  Scenario: The per-context usage round-trips through the session row
    Given a session that charged usage to two contexts
    When the session fold writes and the row is read back
    Then the row carries each context's tokens and cost

  @integration
  Scenario: A session row from before the per-context usage column decodes with none
    Given a session row written before the per-context usage column existed
    When the row is read back
    Then the session decodes with no per-context usage
