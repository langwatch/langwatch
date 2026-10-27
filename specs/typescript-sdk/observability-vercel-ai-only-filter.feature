Feature: The vercelAIOnly preset keeps the Vercel AI SDK's spans across SDK versions
  As a developer exporting only my Vercel AI SDK spans to LangWatch
  I want the vercelAIOnly preset to recognise the spans every AI SDK version emits
  So that upgrading to AI SDK 7 does not silently drop my traces

  # AI SDK 6 and earlier emit spans under the "ai" instrumentation scope; AI SDK 7
  # emits them under "gen_ai".
  #
  # Implementation:
  #   sdks/typescript/src/observability-sdk/exporters/trace-filters.ts

  @unit
  Scenario: AI SDK 7's gen_ai spans pass the vercelAIOnly preset
    When a span carries the "gen_ai" instrumentation scope, in any letter case
    Then the vercelAIOnly preset treats it as a Vercel AI SDK span and keeps it
    And a span under the "ai" scope is still kept
