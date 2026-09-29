# Single-session lookups read only the data that can hold the session
#
# Implementation:
#   platform/app/src/server/clickhouse/migrations/00101_add_coding_agent_sessions_session_id_index.sql (the SessionId skip index)
#   platform/app/src/server/app-layer/coding-agent/repositories/coding-agent-session.clickhouse.repository.ts (findBySessionId)
#
# Related specs:
#   specs/coding-agent/session-aggregate.feature , the session fold whose row these lookups read
#
# Motivation: coding_agent_sessions is sorted by (TenantId, StartedAt, SessionId),
# which leads with time. The session-by-id read keeps its latest-version subquery
# unwindowed for correctness, and with StartedAt unconstrained the sort key cannot
# rule out any part of the project's history on SessionId. Before the index, a
# lookup read one block per part the project had written, and a lookup for a
# session that does not exist read all of them to find nothing.

Feature: Single-session lookups read only the data that can hold the session

  Background:
    Given a project whose coding agent sessions span several weeks

  @integration
  Scenario: Looking up a session that does not exist reads nothing
    Given the project's sessions sort either side of the requested id in one block
    When the session is looked up by its id
    Then no rows are read
    And the same lookup with the index disabled does read that block

  @integration
  Scenario: Looking up a session returns the version that folded the most
    Given two versions of one session written at the same moment
    And one of them folded more model calls than the other
    When the session is looked up by its id
    Then the version with more model calls is returned

  @integration
  Scenario: A session id used in two projects resolves within the requesting project
    Given two projects that each hold a session with the same id
    When each project looks the session up
    Then each project reads back its own session
