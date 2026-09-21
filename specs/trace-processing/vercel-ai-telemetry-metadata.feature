# The Vercel AI SDK has its own metadata channel.
#
# `generateText({ experimental_telemetry: { isEnabled: true, metadata: {...} } })`
# flattens every entry onto the spans it emits as `ai.telemetry.metadata.<key>`,
# one attribute per key. That is the only metadata channel a Vercel AI SDK user
# has without dropping to raw OpenTelemetry, and it is how the SDK's own
# documentation tells people to tag a call.
#
# The trace summary is built from span attributes and reads `langwatch.*`,
# `gen_ai.*` and `tag.tags`. It did not read `ai.telemetry.metadata.*`, so a
# Vercel AI call tagged with labels, a user id or a thread id arrived with none
# of them: the labels facet stayed empty, the call joined no conversation, and
# custom keys were dropped. The legacy collector mapper has understood this
# shape since the Vercel integration shipped, which is what made the gap hard
# to see: the same payload behaved differently on the two read paths.
#
# The reserved names are the same ones every other channel uses, so a value the
# customer set explicitly through `langwatch.*` always wins over the same value
# arriving through the Vercel channel.

Feature: Vercel AI SDK telemetry metadata reaches the trace summary
  As a developer tracing an application built on the Vercel AI SDK
  I want the metadata I pass to experimental_telemetry to reach my traces
  So that I can filter by label, group by conversation and find a user's calls
  without writing OpenTelemetry attributes by hand.

  Background:
    Given a project that receives spans over OTLP

  # ─── Labels ────────────────────────────────────────────────────────

  @unit
  Scenario: Labels passed to experimental_telemetry reach the trace
    Given a span with ai.telemetry.metadata.labels = ["checkout", "beta"]
    When the trace summary is built
    Then the trace has the labels "checkout" and "beta"

  @unit
  Scenario: Vercel labels join labels sent by another span of the same trace
    Given a span with ai.telemetry.metadata.labels = ["checkout"]
    And another span of the same trace with langwatch.labels = ["prod"]
    When the trace summary is built
    Then the trace has the labels "checkout" and "prod"
    And each label appears once

  # ─── Trace identity ────────────────────────────────────────────────

  @unit
  Scenario: A user id passed to experimental_telemetry identifies the trace
    Given a span with ai.telemetry.metadata.user_id = "user-42"
    When the trace summary is built
    Then the trace user id is "user-42"

  @unit
  Scenario: A thread id passed to experimental_telemetry groups the conversation
    Given a span with ai.telemetry.metadata.thread_id = "thread-9"
    When the trace summary is built
    Then the trace conversation id is "thread-9"

  @unit
  Scenario: A customer id passed to experimental_telemetry reaches the trace
    Given a span with ai.telemetry.metadata.customer_id = "acme"
    When the trace summary is built
    Then the trace customer id is "acme"

  @unit
  Scenario: The camelCase spelling of an identity key is accepted
    Given a span with ai.telemetry.metadata.threadId = "thread-9"
    When the trace summary is built
    Then the trace conversation id is "thread-9"

  # ─── Custom keys ───────────────────────────────────────────────────

  @unit
  Scenario: A key that is not reserved becomes custom trace metadata
    Given a span with ai.telemetry.metadata.tenant = "eu-west"
    When the trace summary is built
    Then the trace metadata key "tenant" is "eu-west"

  @unit
  Scenario: A non-string value keeps its own shape in custom metadata
    Given a span with ai.telemetry.metadata.retry_count = 3
    When the trace summary is built
    Then the trace metadata key "retry_count" is "3"

  # ─── Precedence ────────────────────────────────────────────────────

  @unit
  Scenario: An explicit LangWatch attribute wins over the Vercel channel
    Given a span with langwatch.user.id = "explicit-user"
    And the same span with ai.telemetry.metadata.user_id = "vercel-user"
    When the trace summary is built
    Then the trace user id is "explicit-user"

  @unit
  Scenario: An explicit custom metadata attribute wins over the Vercel channel
    Given a span with the metadata attribute "tenant" set to "explicit"
    And the same span with ai.telemetry.metadata.tenant = "vercel"
    When the trace summary is built
    Then the trace metadata key "tenant" is "explicit"

  # ─── Not a metadata key ────────────────────────────────────────────

  @unit
  Scenario: The Vercel telemetry keys that are not metadata are left alone
    Given a span with ai.telemetry.functionId = "checkout-flow"
    When the trace summary is built
    Then the trace has no custom metadata key "functionId"
