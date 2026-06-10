# Trace Peek — Gherkin Spec
# Implementation: langwatch/src/features/traces-v2/components/TraceIdPeek.tsx
#
# IMPORTANT (audit 2026-05-01):
# The originally-specified "pull-tab + sustained hover + peek panel inline in
# the table" model was never built. The shipped TraceIdPeek is a small Eye
# icon button (16px, lucide `Eye`) that renders next to a trace ID anywhere
# in the platform. It uses a Chakra `HoverCard` popover that opens after a
# ~400ms hover delay; clicking the icon opens the trace drawer.
#
# Almost every scenario in the previous version of this file described the
# pull-tab model, table-row peeking, full-width inline panel, and "side-by-side
# comparison with the drawer". None of that is in the code. The whole file has
# been reduced to what the actual `TraceIdPeek` component does. Aspirational
# scenarios were removed rather than `@planned`-tagged because they describe
# a fundamentally different interaction surface — preserving them would just
# rot.

Feature: Trace ID hover peek

Rule: Eye-icon trigger
  TraceIdPeek renders a small Eye icon button next to a trace ID.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the "release_ui_traces_v2_enabled" feature flag is enabled

  Scenario: Eye icon renders next to a trace ID
    When a TraceIdPeek is rendered with a traceId
    Then a 16px Eye icon button is visible
    And the icon is muted by default and brightens on hover

  Scenario: Component is hidden when the feature flag is off
    Given the "release_ui_traces_v2_enabled" feature flag is disabled
    When TraceIdPeek would render
    Then nothing is rendered

  Scenario: Sustained hover opens the popover
    When the user hovers the Eye icon for ~400ms
    Then a HoverCard popover opens at "bottom-start"

  Scenario: Moving away closes the popover after a short delay
    Given the popover is open
    When the user moves the cursor away from the icon and the popover
    Then the popover closes after ~200ms


Rule: Popover content
  The popover shows a compact header-only summary of the trace, fetched via
  `api.tracesV2.header`. No span data or full I/O is fetched here.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the popover is open for a trace

  Scenario: Popover lazily fetches the trace header on first open
    Given the popover has not been opened before for this trace
    When the popover opens
    Then `api.tracesV2.header` is called for that trace
    And subsequent opens reuse the cached result for ~5 minutes

  Scenario: Loading state shows skeletons
    Given the trace header is still loading
    Then the popover shows three Skeleton placeholders

  Scenario: Header shows status dot and trace name
    Then a status-coloured circle is shown for the trace status
    And the trace name (or root span name) is shown next to it

  Scenario: Metrics row shows duration and conditional metrics
    Then a "Duration" metric is always visible
    And a "Cost" metric appears only when totalCost > 0
    And a "Tokens" metric appears only when totalTokens > 0
    And a "Model" metric appears only when at least one model is recorded
    And a "Spans" metric is always visible

  Scenario: I/O preview shows truncated input and output
    Given the trace has either input or output captured
    Then an "Input" block shows the first two lines of `trace.input` in mono font
    And an "Output" block shows the first two lines of `trace.output` in mono font

  Scenario: Error block is rendered for errored traces
    Given the trace has an error message
    Then a red-tinted block shows the first two lines of the error

  Scenario: Footer shows a truncated trace ID and the service name
    Then the popover footer shows the first 16 characters of the trace ID followed by "..."
    And the popover footer shows the trace's service name


Rule: Click opens the drawer
  Clicking the Eye icon (or anywhere on the popover trigger) closes the
  popover and opens the standard trace drawer for that trace.

  Background:
    Given the user is authenticated with "traces:view" permission

  Scenario: Clicking the Eye icon opens the drawer
    When the user clicks the Eye icon
    Then the popover closes
    And `useDrawer().openDrawer("traceV2Details", { traceId })` is invoked

  Scenario: Clicking inside the popover does not bubble to the row
    Given the popover is open inside a clickable trace row
    When the user clicks the Eye icon
    Then the parent row's click handler does not fire
