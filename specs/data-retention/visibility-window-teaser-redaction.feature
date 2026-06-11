Feature: Plan-based visibility windows via teaser redaction
  As a LangWatch operator
  I want Free-tier trace content older than the plan's visibility window
  redacted server-side to a short teaser with an upgrade call-to-action
  So that retention becomes a recoverable upgrade incentive instead of
  silent data loss, while paying customers are never affected

  # ADR-028 (dev/docs/adr/028-visibility-blur-teaser-redaction.md), issue #4745.
  # The 49-day deletion floor is untouched — this is a read-path visibility
  # gate only. Free plans (and self-hosted unlicensed, which resolve to the
  # free plan) get a 14-day window; every paid, enterprise, or licensed plan
  # has no blur at all. Evaluation is stateless at read time against the
  # current plan: upgrades unblur instantly, downgrades re-blur instantly.
  # Trace existence and metadata (timestamps, durations, status, costs,
  # model names) always stay visible; only content is teased.

  Background:
    Given an organization "acme" with a project "web-app"
    And a trace "old-trace" in "web-app" whose content fields are 5000 characters long, started 15 days ago
    And a trace "fresh-trace" in "web-app" with the same content, started 5 days ago

  Scenario: Free org reading an old trace gets teaser-redacted content
    Given "acme" resolves to the free plan
    When the trace detail for "old-trace" is fetched
    Then every content field is truncated to at most 300 characters
    And the response is marked as redacted with the plan's visibility window
    And trace metadata (timestamps, duration, status, cost, model) is unchanged

  Scenario: Free org reading a fresh trace sees full content
    Given "acme" resolves to the free plan
    When the trace detail for "fresh-trace" is fetched
    Then all content fields are returned in full
    And the response is not marked as redacted

  Scenario: Teaser keeps short content legible and never exceeds the cap
    Given "acme" resolves to the free plan
    And a trace "tiny-trace" started 15 days ago whose content fields are 40 characters long
    When the trace detail for "tiny-trace" is fetched
    Then each content field keeps its first characters up to the 50-character floor
    And a 5000-character field keeps exactly 300 characters

  Scenario: Paid org is never redacted regardless of trace age
    Given "acme" resolves to a paid plan
    When the trace detail for "old-trace" is fetched
    Then the response is byte-identical to the unredacted trace
    And the response is not marked as redacted

  Scenario: Upgrading unblurs instantly with no stored state
    Given "acme" resolves to the free plan
    And the trace detail for "old-trace" was fetched and returned redacted
    When "acme" upgrades to a paid plan
    And the trace detail for "old-trace" is fetched again
    Then all content fields are returned in full

  Scenario: Downgrading re-blurs instantly
    Given "acme" resolves to a paid plan
    And the trace detail for "old-trace" was fetched and returned in full
    When "acme" downgrades to the free plan
    And the trace detail for "old-trace" is fetched again
    Then every content field is truncated to the teaser

  Scenario: Both read stacks redact — legacy trace service and spans
    Given "acme" resolves to the free plan
    When the spans of "old-trace" are fetched through the spans read path
    Then every span content field is truncated to the teaser
    And span metadata (timing, type, model, token counts) is unchanged

  Scenario: Error and parameter payloads count as content
    Given "acme" resolves to the free plan
    And "old-trace" has a span with an error stack and parameter strings embedding prompt text
    When the spans of "old-trace" are fetched
    Then the error body and parameter string values are truncated to the teaser
    And the model name and token counts remain visible

  Scenario: Trace lists keep existence and metadata for old traces
    Given "acme" resolves to the free plan
    When the trace list for the last 30 days is fetched
    Then "old-trace" and "fresh-trace" both appear with identical counts and metadata as for a paid org
    And only content previews of traces older than 14 days are teased

  Scenario: Analytics aggregates are not affected by the visibility window
    Given "acme" resolves to the free plan
    When analytics timeseries spanning the last 30 days are fetched
    Then totals, costs, and latencies equal those of a paid org with identical data

  Scenario: Plan resolution failure fails closed
    Given plan resolution for "acme" throws an error
    When the trace detail for "old-trace" is fetched
    Then the content is redacted as if "acme" were on the free plan
    And the failure is logged for alerting

  Scenario: Self-hosted unlicensed installation behaves like the free plan
    Given the installation is self-hosted without a license
    When the trace detail for "old-trace" is fetched
    Then every content field is truncated to the teaser

  Scenario: REST API reads are gated the same as the app UI
    Given "acme" resolves to the free plan
    When "old-trace" is fetched through the public REST API with a valid API key
    Then every content field is truncated to the teaser

  Scenario: Public share links redact old content
    Given "acme" resolves to the free plan
    And a public share link exists for "old-trace"
    When the shared trace is opened without authentication
    Then every content field is truncated to the teaser

  Scenario: Exports redact content columns of old traces
    Given "acme" resolves to the free plan
    When traces of the last 30 days are exported
    Then content columns of "old-trace" are truncated to the teaser
    And content columns of "fresh-trace" are exported in full
