Feature: Coding-agent session and turn tracking

  Coding-agent sessions span many LLM calls (steps). A session-level view
  accumulates step counts, context growth, compaction events, and per-category
  cost totals so customers can see how a session's context evolved and where
  its spend went. Compaction detection must survive out-of-order delivery and
  interleaved subagent steps without firing false events. (ADR-033)

  Background:
    Given the trace processing pipeline is running

  @unit @unimplemented
  Scenario: Steps of a session are accumulated into a session view
    Given multiple coding-agent spans sharing the same session id
    When the spans are processed
    Then the session view counts every step
    And the session view accumulates the per-category cost totals across steps

  @unit @unimplemented
  Scenario: Steps are ordered by start time regardless of arrival order
    Given coding-agent spans of one session arriving out of chronological order
    When the spans are processed
    Then the session's context-growth sequence is ordered by span start time

  @unit @unimplemented
  Scenario: A compaction event is detected when the session context re-bases
    Given a session whose step input sizes grow steadily, then drop sharply, then keep growing from the lower base
    When the spans are processed
    Then the session view records one compaction event

  @unit @unimplemented
  Scenario: A small parallel step does not fire a compaction event
    Given a session with large main-thread steps and one small interleaved subagent step
    When the spans are processed
    Then the session view records no compaction event

  @unit @unimplemented
  Scenario: Sessions from different harnesses are keyed independently
    Given a Claude Code session and a Codex session processed in the same project
    When the spans are processed
    Then each session view is keyed by its own harness session id
    And the views do not mix steps
