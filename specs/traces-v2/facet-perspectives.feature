# Facet perspectives — three task-oriented views of the facet manager
#
# Design: dev/docs/adr/028-trace-facet-sidebar-presentation-and-perspectives.md
#
# Implementation:
#   langwatch/src/features/traces-v2/components/FilterSidebar/constants.ts       (FACET_GROUPS refined into finer sub-groups)
#   langwatch/src/features/traces-v2/components/FilterSidebar/FacetManagerPopover.tsx  (perspective switcher + grouped checklist)
#   langwatch/src/features/traces-v2/stores/facetLensStore.ts                    (built-in perspectives + activePerspectiveId)
#   langwatch/src/features/traces-v2/components/FilterSidebar/hooks/useFilterSidebarData.ts  (consumes groupOrder/sectionOrder)
#   langwatch/src/features/traces-v2/components/FilterSidebar/__tests__/facetGroups.unit.test.ts  (pinned taxonomy)
#
# Related specs:
#   specs/traces-v2/lens-preset-groups.feature — the SEPARATE trace-list lens system (toolbar LensTabs); different control
#   specs/traces-v2/view-system.feature        — trace-list lens/view system
#   specs/traces-v2/search.feature             — facet sidebar + manager ("Configure") basics
#
# Motivation: the facet manager lists every facet under nine fixed group
# headers, and the sidebar is one flat ordered column. Different jobs want
# facets surfaced in different orders: an operator debugging looks for errors
# and spans first; someone tuning a model wants model/prompt/quality first;
# someone watching spend wants cost/latency first. Round 5 adds three built-in
# "perspectives" — Observability, LLM, Cost & Performance — each a complete
# re-grouping and re-ordering of ALL facets. The manager shows one perspective
# at a time via a switcher; the sidebar reorders to match.
#
# Terminology: these are "perspectives", NOT "lenses". The toolbar already has
# "lenses" (viewStore / LensTabs) that sort & filter the TRACE LIST — a
# different control. Perspectives only reorganise the facet sidebar/manager.
#
# Sub-groups (proposed — refine in review). All facets belong to exactly one
# sub-group; every sub-group appears in every perspective:
#   Traces          origin, rootSpanType, traceName, metadata + trace-attribute keys
#   Errors          status, errorMessage, guardrail, containsAi
#   Spans & Events  spanType, spanName, spanStatus, event, span- + event-attribute keys
#   Subjects        user, conversation, customer, scenarioRun
#   Model           model, service
#   Prompts         selectedPrompt, lastUsedPrompt, promptVersion
#   Quality         evaluator, evaluatorStatus, evaluatorVerdict, evaluatorScore, annotation
#   Topics          topic, subtopic, label
#   Cost            cost, tokens, promptTokens, completionTokens, tokensEstimated
#   Latency         duration, ttft, ttlt, tokensPerSecond
#   Volume          spans
#   Custom          fallback bucket for any section key not mapped above (empty by default)
#
# Perspective lead order over those sub-groups (proposed — refine in review):
#   Observability:     Traces, Errors, Spans & Events, Subjects, Latency, Volume, Cost, Model, Quality, Topics, Prompts, Custom
#   LLM:               Model, Prompts, Quality, Topics, Subjects, Cost, Volume, Traces, Spans & Events, Errors, Latency, Custom
#   Cost & Performance: Cost, Latency, Volume, Model, Traces, Errors, Quality, Spans & Events, Subjects, Topics, Prompts, Custom
#
# Decisions:
#   - Three built-in perspectives; Observability is the default on first use.
#   - A perspective re-groups + re-orders ALL facets — it does not hide any.
#   - The manager shows sub-group headers in the active perspective's order;
#     the sidebar stays flat (no headers) but follows the same order.
#   - Visibility (which facets are shown/hidden) and numeric mode are
#     independent of the perspective.

Feature: Facet perspectives

Rule: The facet manager offers three perspectives
  A switcher at the top of the manager ("Configure") chooses one of three
  task-oriented perspectives. It is the facet sidebar's organiser, separate
  from the toolbar's trace-list lenses.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the facet manager is open

  Scenario: The three perspectives are offered
    Then the manager shows a perspective switcher
    And it offers "Observability", "LLM", and "Cost & Performance"

  Scenario: Observability is the default for a new user
    Given the user has never chosen a perspective
    Then the active perspective is "Observability"

  Scenario: Each perspective groups facets by sub-groups
    When the user selects the "LLM" perspective
    Then the manager lists facets under sub-group headers
    And "Model", "Prompts", and "Quality" lead the order

Rule: A perspective re-groups the manager and reorders the sidebar
  Selecting a perspective changes the active facet arrangement, which both the
  manager and the sidebar read. The sidebar reorders to put the perspective's
  lead sub-groups first.

  Background:
    Given the user is authenticated with "traces:view" permission

  Scenario: Selecting Cost & Performance front-loads cost and latency
    When the user selects the "Cost & Performance" perspective
    Then the sidebar lists Cost, Latency, and Volume facets before the rest
    And the manager shows the same order under its headers

  Scenario: The Storage size facet appears in the Cost & Performance perspective
    When the user selects the "Cost & Performance" perspective
    Then a "Storage size" facet is offered under the Volume sub-group
    And it filters traces by stored payload size as a numeric range
    # Storage size measures the trace's stored payload bytes — a volume signal
    # users reach for when hunting the heaviest traces. Backed by the
    # materialised `_size_bytes` column on `trace_summaries`.

  Scenario: Selecting Observability front-loads errors and spans
    When the user selects the "Observability" perspective
    Then the sidebar lists Traces, Errors, and Spans & Events facets before the rest

  Scenario: The active perspective persists across reloads
    Given the user selected the "LLM" perspective
    When the user reloads the page
    Then the active perspective is still "LLM"

Rule: Every facet appears in every perspective
  A perspective reorganises the full facet set; it never drops a facet.
  Switching perspective is purely about order and grouping.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the facet manager is open

  Scenario: All facets are present regardless of perspective
    Given the manager lists N facets under the "Observability" perspective
    When the user switches to the "Cost & Performance" perspective
    Then the same N facets are listed, only re-grouped and re-ordered

  Scenario: Perspective does not change facet visibility
    Given the user has hidden the "Topic" facet
    When the user switches perspective
    Then "Topic" remains hidden in the sidebar
    And its hidden/shown state is unchanged in the manager

Rule: Perspectives are distinct from the toolbar trace-list lenses
  The toolbar lenses (All, Errors, Expensive Traces…) sort and filter the
  trace list. Facet perspectives only reorganise the facet sidebar. The two do
  not drive each other.

  Background:
    Given the user is authenticated with "traces:view" permission

  Scenario: Choosing a trace-list lens does not change the facet perspective
    Given the active facet perspective is "LLM"
    When the user selects the "Errors" trace-list lens in the toolbar
    Then the active facet perspective is still "LLM"

  Scenario: Choosing a facet perspective does not change the trace-list lens
    Given the active trace-list lens is "All"
    When the user selects the "Cost & Performance" facet perspective
    Then the active trace-list lens is still "All"

Rule: A custom drag-reorder is preserved without overwriting a built-in
  Dragging facets to a custom order layers a personal arrangement on top of
  the active perspective rather than mutating the built-in, so the built-in
  perspectives can always be returned to cleanly.

  Background:
    Given the user is authenticated with "traces:view" permission

  Scenario: Dragging a facet creates a custom arrangement
    Given the active perspective is "Observability"
    When the user drags a facet to a new position
    Then the custom order is applied and persisted
    And re-selecting "Observability" restores its built-in order

Rule: Saved arrangements survive the sub-group refinement
  Refining the nine legacy groups into finer sub-groups must not strand a
  user's previously persisted arrangement.

  Scenario: A previously saved arrangement still opens after the refinement
    Given the user saved a facet arrangement before the sub-groups were refined
    When the user opens the facet sidebar
    Then the saved arrangement still opens without breaking the view
    And any facets the saved arrangement no longer covers appear in their default order
    And no facet is lost from the sidebar

Rule: The sidebar never renders blank when the project has traces
  A project that has received traces must always see facets to filter on. If
  discover returns nothing usable for the current view — no values, no ranges,
  no attribute keys — the sidebar falls back to the default minimal facet set
  rather than collapsing to an empty rail. The fallback rows are interactive
  placeholders, identical to the cold-start defaults shown before traces arrive.

  Background:
    Given the user is authenticated with "traces:view" permission

  Scenario: Project with traces but no resolvable facets shows the default minimal facet set
    Given the project has received traces
    But discover resolves no usable facets for the current view
    When the user opens the facet sidebar
    Then the sidebar shows the default minimal facet set
    And the rail is not blank

  Scenario: Discover returning only empty descriptors still renders defaults
    Given the project has received traces
    And discover returns descriptors whose values, ranges, and attribute keys are all empty
    When the user opens the facet sidebar
    Then the default facets render as interactive placeholders
    And no section is dropped just because its discovered values were empty
