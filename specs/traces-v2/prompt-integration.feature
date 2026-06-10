# Prompt Integration — Gherkin Spec
# Covers: detection, accordion layout, header, template, variables, version mismatch, actions, auto-open rules, data gating
# Plus trace-level surfacing: header chips and the dedicated Prompts tab.

# ─────────────────────────────────────────────────────────────────────────────
# TRACE-LEVEL PROMPT CHIP
# ─────────────────────────────────────────────────────────────────────────────

Feature: Prompt integration

Rule: Trace-level prompt chips (Selected + Last used)
  The drawer header surfaces up to two prompt chips, derived from the
  trace-summary projection's `selectedPromptId` / `lastUsedPromptId`
  fields (rolled up at ingest from `langwatch.prompt.selected.id` and
  `langwatch.prompt.id` span attributes). A "Selected" chip + a "Last
  used" / "Prompt" chip are emitted by `useTraceHeaderChipDefs`.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the drawer is open in Trace mode

  Scenario: One chip per derived prompt identity (selected and/or last used)
    Given the trace summary has selectedPromptId = "billing-helper" and lastUsedPromptId = "billing-helper" (same handle)
    Then a single "Prompt" chip is shown (Selected and Last used collapsed when identical)

  Scenario: Selected and last-used handles diverge, two chips render
    Given the trace summary has selectedPromptId = "billing-helper" and lastUsedPromptId = "fallback-bot"
    Then a "Selected" chip is shown for "billing-helper"
    And a "Last used" chip is shown for "fallback-bot" with a yellow tone (drift)

  Scenario: Last-used chip includes the version number when known
    Given the trace summary has lastUsedPromptVersionNumber = 7
    Then the chip value reads "<handle> v7"

  Scenario: Clicking the last-used chip selects the source span (or opens Prompts tab)
    When the user clicks the last-used prompt chip
    Then if `lastUsedPromptSpanId` is set, the drawer selects that span
    And otherwise the drawer's active tab switches to "prompts"

  Scenario: No chip for traces without managed prompts
    Given the trace summary has no selectedPromptId or lastUsedPromptId
    Then no prompt chips are emitted by `useTraceHeaderChipDefs`

  @planned
  Scenario: Per-prompt-version chip popover with deep links
    # Not yet implemented as of 2026-05-01 — chips render a tooltip with
    # contextual prose, but no popover with explicit "View in Prompts tab"
    # / "Open in Prompts" buttons.
    When the user clicks a prompt chip
    Then a popover shows links to "View in Prompts tab" and "Open in Prompts"


# ─────────────────────────────────────────────────────────────────────────────
# PROMPTS DRAWER TAB
# ─────────────────────────────────────────────────────────────────────────────

Rule: Prompts drawer tab
  When the trace contains a managed prompt (containsPrompt or fallback
  trace.attributes["langwatch.prompt_ids"]), a "Prompts" tab joins the
  Trace / LLM tabs. The panel groups all prompt usage by reference so the
  user can compare variables and see which spans called each prompt.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the drawer is open in Trace mode

  Scenario: Tab appears only when the trace has managed prompts
    Given the trace has at least one managed prompt (`containsPrompt = true` or `langwatch.prompt_ids` populated)
    Then a "Prompts" tab is visible in the tab bar
    Given another trace with no managed prompts
    Then the "Prompts" tab is not shown

  Scenario: Panel header shows the prompt count
    Given the aggregated `usages.length` is 3
    When the user activates the Prompts tab
    Then the panel header reads "3 prompts in this trace"

  Scenario: Prompts are aggregated by promptReferenceKey (handle + version + tag)
    Given the trace has 5 spans referencing "refund-policy v4"
    And the trace has 1 span referencing "summary-bot v2"
    When the Prompts panel renders
    Then exactly two `PromptUsageCard`s are visible
    And the "refund-policy v4" card lists 5 spans
    And the "summary-bot v2" card lists 1 span

  Scenario: Variable values render alphabetically
    Given a prompt's spans captured variables {"topic": "refunds", "company": "Acme"}
    When the Prompts panel renders the prompt card
    Then the variables list shows "company" before "topic"

  Scenario: Spans not yet loaded show a skeleton
    Given the trace summary lists a prompt id but `useSpansFull` is still loading
    When the Prompts panel renders that prompt card
    Then the spans section shows a skeleton placeholder

  Scenario: Clicking a span row focuses that span via onSelectSpan
    Given a prompt card lists 3 spans
    When the user clicks a span row
    Then `onSelectSpan(spanId)` is invoked

  Scenario: "Open prompt" opens the prompt editor drawer
    When the user clicks "Open prompt" on a prompt card
    Then `openDrawer("promptEditor", { promptId: handle })` is called
    # No new browser tab — the prompt editor drawer overlays the current page.

  Scenario: Selected vs Last-used callout banner
    Given the trace's selectedPromptId differs from its lastUsedPromptId
    When the Prompts panel renders
    Then a yellow "Pinned prompt drifted at runtime" callout appears at the top of the panel

  Scenario: Out-of-date prompt warning when latest > recorded version
    Given lastUsedPromptVersionNumber is 4 and `usePromptByHandle` reports latestVersion = 6
    When the Prompts panel renders
    Then a yellow "Trace ran an out-of-date prompt" callout appears

  Scenario: Missing prompt callout when handle no longer exists
    Given `usePromptByHandle` returns missing=true for the lastUsedPromptId
    Then a "Prompt no longer exists in this project" callout appears



# ─────────────────────────────────────────────────────────────────────────────
# DETECTION
# ─────────────────────────────────────────────────────────────────────────────

Rule: Prompt accordion detection
  The Prompt accordion appears only when a span carries any
  `langwatch.prompt.*` attribute (`hasPromptMetadata`).

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user has selected a span in the trace visualization

  Scenario: Accordion appears when any langwatch.prompt.* attribute is present
    Given the span has at least one of `langwatch.prompt.id`, `langwatch.prompt.handle`, `langwatch.prompt.version.number`, `langwatch.prompt.selected.id`, or `langwatch.prompt.variables`
    When the span tab renders
    Then the Prompt accordion section is included in the span accordion list

  Scenario: Accordion hidden when span has no prompt attributes
    Given the span has no `langwatch.prompt.*` attributes
    When the span tab renders
    Then the Prompt accordion is not shown

  Scenario: Detection uses attributes, not span type
    Given the span type is "LLM" but has no prompt attributes
    When the span tab renders
    Then the Prompt accordion is not shown


# ─────────────────────────────────────────────────────────────────────────────
# ACCORDION LAYOUT AND ORDER
# ─────────────────────────────────────────────────────────────────────────────

Rule: Prompt accordion layout
  The Prompt accordion sits between I/O and Attributes in the span tab.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user has selected a span with prompt metadata

  Scenario: Accordion order with prompt metadata
    When the span tab renders
    Then the accordion sections are "Input and Output", "Prompt", "Attributes", "Events"
    # `Exceptions` may be inserted before or after I/O depending on whether
    # the span errored and whether it has I/O.

  Scenario: Accordion order without prompt metadata
    Given the user has selected a span without prompt metadata
    When the span tab renders
    Then the accordion sections are "Input and Output", "Attributes", "Events"


# ─────────────────────────────────────────────────────────────────────────────
# HEADER
# ─────────────────────────────────────────────────────────────────────────────

Rule: Prompt accordion header
  The header shows the prompt handle, version badge, and (when present) tag badge.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user has selected a span with prompt metadata

  Scenario: Header displays prompt handle and version badge
    Given the span has prompt handle "refund-policy-agent" and version number 4
    When the Prompt accordion renders
    Then the header shows "refund-policy-agent" in monospace bold
    And a "v4" subtle Badge is rendered

  Scenario: Header shows tag badge when present
    Given the span has prompt handle "refund-policy-agent" and tag "production"
    Then the header shows a "production" outline badge with a blue palette

  Scenario: Header gracefully handles missing handle
    Given the span has variables-only prompt metadata
    Then the header shows "Prompt (no handle on span)" in muted tone

  @planned
  Scenario: Active-version indicator on the accordion header
    # Not yet implemented as of 2026-05-01 — span-level PromptAccordion
    # does not call `usePromptByHandle` and therefore renders no
    # active/inactive indicator. Active-version comparison happens at the
    # trace-level Prompts panel (see `SelectedVsLastUsedCallout`).
    Given the span used version "1.4" and the currently active version is "1.4"
    When the Prompt accordion renders
    Then the header shows a green dot with "active"


# ─────────────────────────────────────────────────────────────────────────────
# TEMPLATE
# ─────────────────────────────────────────────────────────────────────────────

@planned
Rule: Prompt template display
  Not yet implemented as of 2026-05-01 — `PromptAccordion` does not render
  any prompt template body. Only handle, version, tag, variables, and
  actions render. The scenarios below describe target behaviour for when
  span-level template payloads are wired through.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user has selected a span with prompt metadata
    And the Prompt accordion is expanded

  Scenario: Template renders in a monospace code block
    Given the span has a prompt template
    When the template section renders
    Then the template text is displayed in a monospace code block

  Scenario: Variable placeholders are highlighted
    Given the span has a prompt template containing "{{company}}" and "{{topic}}"
    When the template section renders
    Then the "{{company}}" placeholder has a subtle background highlight
    And the "{{topic}}" placeholder has a subtle background highlight

  Scenario: Long template is truncated with expander
    Given the span has a prompt template longer than 500 characters
    When the template section renders
    Then approximately the first 300 characters are shown
    And a "Show full template" expander is visible

  Scenario: Expanding a long template shows full text
    Given the template is truncated
    When the user clicks "Show full template"
    Then the full template text is displayed

  Scenario: Copy button copies the full template
    Given the span has a prompt template
    When the user clicks the template copy button
    Then the full template text is copied to the clipboard

  Scenario: Missing template shows placeholder message
    Given the span has prompt name and version but no template attribute
    When the template section renders
    Then the template section shows "Template not captured."


# ─────────────────────────────────────────────────────────────────────────────
# VARIABLES
# ─────────────────────────────────────────────────────────────────────────────

Rule: Prompt variables display
  The variables section shows the values filled into template placeholders.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user has selected a span with prompt metadata
    And the Prompt accordion is expanded

  Scenario: Variables shown as a key-value list
    Given the span has variables {"company": "Acme Corp", "topic": "refund policy"}
    When the variables section renders
    Then the variables are displayed as a key-value list inside a bordered Box
    And each row shows the variable name (mono, muted) and its value (mono, fg)

  Scenario: Variables sorted alphabetically
    Given the span has variables {"topic": "refund policy", "company": "Acme Corp", "context": "..."}
    When the variables section renders
    Then the variables are ordered "company", "context", "topic"

  Scenario: Each variable value has a hover-revealed copy button
    Given the span has variables with values
    When the user hovers a variable row
    Then a copy button becomes visible on the right end of that row

  Scenario: Copying a variable value
    When the user clicks the copy button for a variable
    Then `navigator.clipboard.writeText(value)` is called

  Scenario: Variables section hidden when no variables exist
    Given the span has no variables on its prompt reference
    When the Prompt accordion renders
    Then the variables section is not shown

  @planned
  Scenario: Long variable values truncated with a "Show full" expander
    # Not yet implemented as of 2026-05-01 — long values render with
    # `truncate` only; there is no expand/collapse affordance.
    Given the span has a variable with a value longer than the display limit
    When the variables section renders
    Then the value is truncated with a "Show full" expander


# ─────────────────────────────────────────────────────────────────────────────
# VERSION MISMATCH WARNING
# ─────────────────────────────────────────────────────────────────────────────

Rule: Version drift / out-of-date warnings (trace-level only)
  Drift and out-of-date warnings live in the trace-level Prompts panel
  (`SelectedVsLastUsedCallout` + last-used header chip tone), not on the
  span-level PromptAccordion.

  Background:
    Given the user is authenticated with "traces:view" permission

  Scenario: Drift callout when selected and last-used differ
    Given the trace summary has selectedPromptId != lastUsedPromptId
    When the Prompts panel renders
    Then a yellow "Pinned prompt drifted at runtime" callout is shown

  Scenario: Out-of-date callout when latest version > recorded
    Given lastUsedPromptVersionNumber=4 and latestVersion=6 from `usePromptByHandle`
    Then a yellow "Trace ran an out-of-date prompt" callout is shown

  Scenario: Last-used header chip turns yellow when drifted or out-of-date
    Given the last-used prompt is drifted or out-of-date
    Then `buildLastUsedPromptChipDef` emits the chip with `tone="yellow"` and a `LuTriangleAlert` icon

  Scenario: No warnings when versions match and no drift
    Given selectedPromptId == lastUsedPromptId and latestVersion == lastUsedPromptVersionNumber
    Then neither callout is shown
    And the last-used chip uses the blue tone with the `LuHistory` icon

  @planned
  Scenario: Span-level version-mismatch banner with diff link
    # Not yet implemented as of 2026-05-01 — `PromptAccordion` does not
    # compare span version to the active prompt version, does not render
    # a yellow mismatch banner, and exposes no diff/compare action.
    Given the span used version "1.4" and the currently active version is "1.6"
    When the Prompt accordion renders
    Then a yellow banner reads "This span used v1.4 but v1.6 is active"
    And a "View diff between v1.4 and v1.6" link is visible


# ─────────────────────────────────────────────────────────────────────────────
# ACTIONS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Prompt accordion actions
  Action buttons at the bottom of the span-level accordion. Only rendered
  when the span carries a parseable handle.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user has selected a span with prompt metadata
    And the Prompt accordion is expanded

  Scenario: "Open prompt" opens the prompt editor drawer
    When the user clicks "Open prompt"
    Then `openDrawer("promptEditor", { promptId: handle })` is called

  Scenario: "Open in Playground" is rendered but currently disabled
    When the Prompt accordion renders for a span with a handle
    Then a disabled "Open in Playground" button is shown
    # Disabled until the playground drawer accepts span input + variables
    # as deep-link params.

  Scenario: No actions render when the span has no parseable handle
    Given the span has variables-only prompt metadata
    Then neither "Open prompt" nor "Open in Playground" is rendered

  @planned
  Scenario: Open in Playground pre-fills span data
    # Not yet implemented as of 2026-05-01 — the button is disabled.
    When the user clicks "Open in Playground"
    Then the playground drawer opens pre-filled with the span's prompt, variables, and messages

  @planned
  Scenario: Compare Versions side-by-side
    # Not yet implemented as of 2026-05-01 — there is no Compare Versions
    # action on the span-level PromptAccordion.
    Given the span used version "1.4" and the active version is "1.6"
    When the user clicks "Compare Versions"
    Then the prompt comparison UI opens


# ─────────────────────────────────────────────────────────────────────────────
# AUTO-OPEN RULES
# ─────────────────────────────────────────────────────────────────────────────

Rule: Prompt accordion auto-open rules
  `useAutoOpenSections` opens the Prompt section whenever the span has
  any prompt metadata — there is no version-mismatch heuristic at the
  span level today.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user has selected a span with prompt metadata

  Scenario: Accordion auto-opens whenever the span has prompt metadata
    Given the span carries any `langwatch.prompt.*` attribute
    When the span tab renders
    Then the Prompt section is included in the auto-open content map and starts expanded

  Scenario: Accordion hidden for spans without prompt metadata
    Given the user has selected a span without prompt metadata
    When the span tab renders
    Then the Prompt section is not added to the accordion list

  @planned
  Scenario: Auto-open only on version mismatch
    # Not yet implemented as of 2026-05-01 — auto-open is presence-based,
    # not mismatch-based. Migrating to mismatch-only would require span-level
    # access to the active prompt version.
    Given the span used a version that differs from the currently active one
    When the span tab renders
    Then the Prompt accordion is auto-opened


# ─────────────────────────────────────────────────────────────────────────────
# DATA GATING
# ─────────────────────────────────────────────────────────────────────────────

Rule: Prompt accordion data gating
  The accordion gracefully handles missing or partial prompt data.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user has selected a span in the trace visualization

  Scenario: No prompt attributes hides accordion entirely
    Given the span has no prompt-related attributes
    When the span tab renders
    Then the Prompt accordion is not shown
    And no "No prompt data" empty state is displayed

  Scenario: Handle without variables shows the header + actions only
    Given the span has prompt handle and version but no variables
    When the Prompt accordion renders
    Then the header (handle + version) and action buttons render
    And the variables section is omitted

  Scenario: Variables-only payload still renders the variables block
    Given the span has variables but no parseable handle
    When the Prompt accordion renders
    Then the variables section renders the values
    And the header reads "Prompt (no handle on span)" in muted tone
    And the action buttons are not rendered (no handle to act on)

  Scenario: Variables-only with no parseable reference falls back to a hint
    Given the span carries `langwatch.prompt.*` keys but neither a parseable handle nor variables
    Then a muted hint reads "Span carries prompt metadata but no parseable handle or variables — likely an incomplete SDK emit."

  @planned
  Scenario: Active version check fails gracefully on the trace-level Prompts panel
    # `usePromptByHandle` already swallows errors via `retry: false` and
    # surfaces `missing` only on NOT_FOUND. There is no dedicated
    # "Could not check active version." tooltip — failure renders as the
    # non-warning default. This scenario is captured for spec parity but
    # is not currently observable as a separate UI state.
    Given the trace's lastUsedPrompt API call errors transiently
    When the Prompts panel renders
    Then the panel shows the prompt without the out-of-date callout
    And a tooltip reads "Could not check active version."
