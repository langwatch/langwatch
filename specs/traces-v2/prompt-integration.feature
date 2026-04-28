# Prompt Integration — Gherkin Spec
# Based on PRD-010: Prompt Integration
# Covers: detection, accordion layout, header, template, variables, version mismatch, actions, auto-open rules, data gating
# Plus trace-level surfacing: header chips and the dedicated Prompts tab.

# ─────────────────────────────────────────────────────────────────────────────
# TRACE-LEVEL PROMPT CHIP
# ─────────────────────────────────────────────────────────────────────────────

Feature: Trace-level prompt chip
  Each unique managed prompt referenced by any span in the trace renders as
  a chip in the drawer header. Driven by the trace-summary projection's
  `langwatch.prompt_ids` aggregation — no per-span fetch is needed.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the drawer is open in Trace mode

  Scenario: Chip appears once per unique prompt + version
    Given two spans on the trace each used "refund-policy v4"
    And one span used "summary-bot v2"
    When the header renders
    Then exactly two prompt chips are visible: "refund-policy v4" and "summary-bot v2"

  Scenario: Chip uses the version when known, the tag otherwise
    Given a span used the prompt id "billing-helper:7"
    Then the chip reads "billing-helper v7"
    Given another span used the prompt id "billing-helper:production"
    Then a separate chip reads "billing-helper production"

  Scenario: Clicking a prompt chip opens a popover
    When the user clicks a prompt chip
    Then a popover shows the handle, version, and links to "View in Prompts tab" and "Open in Prompts"

  Scenario: "View in Prompts tab" switches the drawer tab
    When the user clicks "View in Prompts tab" in the popover
    Then the drawer's Prompts tab becomes the active accordion tab

  Scenario: No chip for traces without managed prompts
    Given no span on the trace referenced a managed prompt
    Then no prompt chips render in the header strip


# ─────────────────────────────────────────────────────────────────────────────
# PROMPTS DRAWER TAB
# ─────────────────────────────────────────────────────────────────────────────

Feature: Prompts drawer tab
  When the trace used at least one managed prompt, a "Prompts" tab joins
  the Trace / LLM tabs. The panel groups all prompt usage by reference so
  the user can compare variables and see which spans called each prompt.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the drawer is open in Trace mode

  Scenario: Tab appears only when the trace has managed prompts
    Given the trace has at least one managed prompt
    Then a "Prompts" tab is visible in the tab bar with a count badge
    Given another trace with no managed prompts
    Then the "Prompts" tab is not shown

  Scenario: Panel header shows the prompt count
    Given the trace used 3 distinct prompt references
    When the user activates the Prompts tab
    Then the panel header reads "3 prompts in this trace"

  Scenario: Prompts are grouped by handle + version
    Given the trace has 5 spans referencing "refund-policy v4"
    And the trace has 1 span referencing "summary-bot v2"
    When the Prompts panel renders
    Then exactly two prompt cards are visible
    And the "refund-policy v4" card lists 5 spans
    And the "summary-bot v2" card lists 1 span

  Scenario: Variable values surface alphabetically
    Given a prompt's spans captured variables {"topic": "refunds", "company": "Acme"}
    When the Prompts panel renders the prompt card
    Then the variables list shows "company" before "topic"

  Scenario: Spans not yet loaded show a skeleton
    Given the trace summary lists a prompt id but spansFull has not loaded
    When the Prompts panel renders that prompt card
    Then the spans section shows a skeleton placeholder
    And the variables section is hidden until spans arrive

  Scenario: Clicking a span row focuses that span in the trace
    Given a prompt card lists 3 spans
    When the user clicks a span row
    Then the drawer selects that span and switches to the span tab

  Scenario: "Open in Prompts" deep-links to the prompt management page
    When the user clicks "Open in Prompts" on a prompt card
    Then a new tab opens at the project's prompts page



# ─────────────────────────────────────────────────────────────────────────────
# DETECTION
# ─────────────────────────────────────────────────────────────────────────────

Feature: Prompt accordion detection
  The Prompt accordion appears only when a span has managed prompt attributes.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user has selected a span in the trace visualization

  Scenario: Accordion appears when span has prompt name attribute
    Given the span has a "langwatch.prompt.name" attribute
    When the span tab renders
    Then the Prompt accordion is visible

  Scenario: Accordion appears when span has prompt version attribute
    Given the span has a "langwatch.prompt.version" attribute
    When the span tab renders
    Then the Prompt accordion is visible

  Scenario: Accordion appears when span has prompt id attribute
    Given the span has a "langwatch.prompt.id" attribute
    When the span tab renders
    Then the Prompt accordion is visible

  Scenario: Accordion hidden when span has no prompt attributes
    Given the span has no prompt-related attributes
    When the span tab renders
    Then the Prompt accordion is not shown

  Scenario: Detection uses attributes not span type
    Given the span type is "LLM" but has no prompt attributes
    When the span tab renders
    Then the Prompt accordion is not shown


# ─────────────────────────────────────────────────────────────────────────────
# ACCORDION LAYOUT AND ORDER
# ─────────────────────────────────────────────────────────────────────────────

Feature: Prompt accordion layout
  The Prompt accordion sits between I/O and Attributes in the span tab.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user has selected a span with prompt metadata

  Scenario: Accordion order with prompt metadata
    When the span tab renders
    Then the accordion order is "I/O", "Prompt", "Attributes"

  Scenario: Accordion order without prompt metadata
    Given the user has selected a span without prompt metadata
    When the span tab renders
    Then the accordion order is "I/O", "Attributes"


# ─────────────────────────────────────────────────────────────────────────────
# HEADER
# ─────────────────────────────────────────────────────────────────────────────

Feature: Prompt accordion header
  The header shows prompt name, version, and active status.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user has selected a span with prompt metadata

  Scenario: Header displays prompt name and version
    Given the span has prompt name "refund-policy-agent" and version "1.4"
    When the Prompt accordion renders
    Then the header shows "refund-policy-agent" in monospace bold
    And the header shows "v1.4" in monospace

  Scenario: Active indicator when span version matches active version
    Given the span used version "1.4"
    And the currently active version is "1.4"
    When the Prompt accordion renders
    Then the header shows a green dot with "active"

  Scenario: Active indicator when span version differs from active version
    Given the span used version "1.4"
    And the currently active version is "1.6"
    When the Prompt accordion renders
    Then the header shows a yellow dot with "v1.6 active"


# ─────────────────────────────────────────────────────────────────────────────
# TEMPLATE
# ─────────────────────────────────────────────────────────────────────────────

Feature: Prompt template display
  The template section shows the full prompt template with highlighted variables.

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

Feature: Prompt variables display
  The variables section shows the values filled into template placeholders.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user has selected a span with prompt metadata
    And the Prompt accordion is expanded

  Scenario: Variables shown as key-value table
    Given the span has variables {"company": "Acme Corp", "topic": "refund policy"}
    When the variables section renders
    Then the variables are displayed as a key-value table
    And each row shows the variable name and its value

  Scenario: Variables sorted alphabetically
    Given the span has variables {"topic": "refund policy", "company": "Acme Corp", "context": "..."}
    When the variables section renders
    Then the variables are ordered "company", "context", "topic"

  Scenario: Each variable value has a copy button
    Given the span has variables with values
    When the variables section renders
    Then each variable row has a copy button

  Scenario: Copying a variable value
    When the user clicks the copy button for a variable
    Then that variable's value is copied to the clipboard

  Scenario: Long variable values are truncated
    Given the span has a variable with a value longer than the display limit
    When the variables section renders
    Then the value is truncated with a "Show full" expander

  Scenario: Expanding a truncated variable value
    Given a variable value is truncated
    When the user clicks "Show full"
    Then the full variable value is displayed

  Scenario: Variables section hidden when no variables exist
    Given the span has no variables attribute
    When the Prompt accordion renders
    Then the variables section is not shown


# ─────────────────────────────────────────────────────────────────────────────
# VERSION MISMATCH WARNING
# ─────────────────────────────────────────────────────────────────────────────

Feature: Version mismatch warning
  A warning appears when the span used a prompt version that is not currently active.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user has selected a span with prompt metadata

  Scenario: Warning banner shown on version mismatch
    Given the span used version "1.4"
    And the currently active version is "1.6"
    When the Prompt accordion renders
    Then a yellow warning banner appears at the top of the accordion
    And it reads "This span used v1.4 but v1.6 is active"

  Scenario: Warning includes version notes when available
    Given the span used version "1.4" and the active version is "1.6"
    And version "1.6" has changelog notes
    When the Prompt accordion renders
    Then the warning banner shows a one-line summary of the version notes

  Scenario: Warning includes link to view version diff
    Given the span used version "1.4" and the active version is "1.6"
    When the Prompt accordion renders
    Then a "View diff between v1.4 and v1.6" link is visible
    And clicking it opens the prompt comparison UI

  Scenario: No warning when span version matches active version
    Given the span used version "1.4"
    And the currently active version is "1.4"
    When the Prompt accordion renders
    Then no version mismatch warning is shown

  Scenario: Trace-level contextual alert on version mismatch
    Given the span used version "1.4" and the active version is "1.6"
    When the trace drawer renders
    Then a contextual alert reads "Span used prompt v1.4 but v1.6 is active"


# ─────────────────────────────────────────────────────────────────────────────
# ACTIONS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Prompt accordion actions
  Action buttons at the bottom of the accordion provide contextual navigation.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user has selected a span with prompt metadata
    And the Prompt accordion is expanded

  Scenario: Open in Playground pre-fills span data
    When the user clicks "Open in Playground"
    Then the prompt playground opens in a new tab
    And it is pre-filled with the span's prompt template
    And it is pre-filled with the span's variable values
    And it is pre-filled with the span's model and parameters
    And it is pre-filled with the span's input messages

  Scenario: Compare Versions opens side-by-side comparison
    Given the span used version "1.4" and the active version is "1.6"
    When the user clicks "Compare Versions"
    Then the prompt comparison UI opens
    And it shows version "1.4" alongside version "1.6"

  Scenario: Compare Versions hidden when versions match
    Given the span used version "1.4"
    And the currently active version is "1.4"
    When the Prompt accordion renders
    Then the "Compare Versions" button is not shown

  Scenario: Edit opens the prompt editor
    When the user clicks "Edit"
    Then the prompt editor opens in a new tab for this template

  Scenario: Open in Playground hidden when playground not available
    Given the prompt playground feature is not available
    When the Prompt accordion renders
    Then the "Open in Playground" button is not shown


# ─────────────────────────────────────────────────────────────────────────────
# AUTO-OPEN RULES
# ─────────────────────────────────────────────────────────────────────────────

Feature: Prompt accordion auto-open rules
  The accordion opens automatically when there is a version mismatch.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user has selected a span with prompt metadata

  Scenario: Accordion starts closed when no version mismatch
    Given the span used version "1.4"
    And the currently active version is "1.4"
    When the span tab renders
    Then the Prompt accordion is closed

  Scenario: Accordion auto-opens on version mismatch
    Given the span used version "1.4"
    And the currently active version is "1.6"
    When the span tab renders
    Then the Prompt accordion is open

  Scenario: Accordion hidden for spans without prompt metadata
    Given the user has selected a span without prompt metadata
    When the span tab renders
    Then the Prompt accordion is not shown


# ─────────────────────────────────────────────────────────────────────────────
# DATA GATING
# ─────────────────────────────────────────────────────────────────────────────

Feature: Prompt accordion data gating
  The accordion gracefully handles missing or partial prompt data.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user has selected a span in the trace visualization

  Scenario: No prompt attributes hides accordion entirely
    Given the span has no prompt-related attributes
    When the span tab renders
    Then the Prompt accordion is not shown
    And no "No prompt data" empty state is displayed

  Scenario: Prompt name without template shows header and actions
    Given the span has prompt name "refund-policy-agent" and version "1.4"
    But the span has no template attribute
    When the Prompt accordion renders
    Then the header shows the prompt name and version
    And the template section shows "Template not captured."
    And the action buttons are visible

  Scenario: Prompt name without template still shows variables if available
    Given the span has prompt name and version but no template
    And the span has variables {"company": "Acme Corp"}
    When the Prompt accordion renders
    Then the variables section is visible with the variable data

  Scenario: No variables hides the variables section
    Given the span has prompt name, version, and template
    But the span has no variables attribute
    When the Prompt accordion renders
    Then the variables section is not shown

  Scenario: Active version check fails gracefully
    Given the span has prompt metadata
    And the API call to check the active version fails
    When the Prompt accordion renders
    Then the prompt data is shown without the active indicator
    And a tooltip reads "Could not check active version."

  Scenario: Playground unavailable hides playground button
    Given the span has prompt metadata
    And the prompt playground feature is not available
    When the Prompt accordion renders
    Then the "Open in Playground" button is not shown
    And the "Edit" button is still visible
