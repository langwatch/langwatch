# Conditional Formatting — Gherkin Spec
# Based on PRD-020: Conditional Formatting
# Covers: supported columns, rule schema, visual rendering, creating rules, removing rules, lens interaction, grouping interaction, data gating, accessibility

# ─────────────────────────────────────────────────────────────────────────────
# SUPPORTED COLUMNS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Conditional formatting supported columns
  Only numeric columns support conditional formatting rules.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has a saved lens with a trace table visible

  Scenario: Numeric columns support conditional formatting
    Then the following columns support conditional formatting:
      | column     | unit    |
      | Duration   | seconds |
      | Cost       | dollars |
      | Tokens     | count   |
      | Tokens In  | count   |
      | Tokens Out | count   |
      | TTFT       | seconds |

  Scenario: Eval score columns support conditional formatting
    Given the lens has an eval score column visible
    Then the eval score column supports conditional formatting

  Scenario: Non-numeric columns do not support conditional formatting
    Then the following columns do not support conditional formatting:
      | column  |
      | Time    |
      | Trace   |
      | Service |
      | Model   |
      | Status  |


# ─────────────────────────────────────────────────────────────────────────────
# RULE SCHEMA
# ─────────────────────────────────────────────────────────────────────────────

Feature: Conditional formatting rule schema
  Rules define color, operator, and threshold for numeric cells.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has a saved lens with a trace table visible

  Scenario: Three colors are available
    When the user opens the formatting popover for a numeric column
    Then the available colors are "red", "yellow", and "green"

  Scenario: Three operators are available
    When the user opens the formatting popover for a numeric column
    Then the available operators are "greater than", "less than", and "between"

  Scenario: Between operator is inclusive on both boundaries
    Given the user creates a rule with operator "between", value 2, and valueTo 5
    Then a cell with value 2 matches the rule
    And a cell with value 5 matches the rule
    And a cell with value 3.5 matches the rule
    And a cell with value 1.9 does not match the rule

  Scenario: A column can have up to 3 rules
    When the user opens the formatting popover for "Duration"
    Then the user can add up to 3 rules, one per color

  Scenario: First matching rule wins when multiple rules match
    Given the user creates a red rule for Duration with operator ">" and value 3
    And the user creates a yellow rule for Duration with operator ">" and value 2
    Then a cell with Duration value 4 is formatted as red
    And a cell with Duration value 2.5 is formatted as yellow

  Scenario: Rules are stored per-lens
    Given the user creates formatting rules on "Lens A"
    And the user switches to "Lens B"
    Then "Lens B" does not have the formatting rules from "Lens A"


# ─────────────────────────────────────────────────────────────────────────────
# VISUAL RENDERING — CELL BACKGROUND
# ─────────────────────────────────────────────────────────────────────────────

Feature: Conditional formatting cell background
  Matching cells get a subtle colored background tint.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has a saved lens with a trace table visible
    And the lens has Duration formatting rules: red > 5s, yellow > 2s, green < 1s

  Scenario: Cell matching red rule shows red background
    Then a Duration cell with value 6.3s has a subtle red background tint

  Scenario: Cell matching yellow rule shows yellow background
    Then a Duration cell with value 3.1s has a subtle yellow background tint

  Scenario: Cell matching green rule shows green background
    Then a Duration cell with value 0.4s has a subtle green background tint

  Scenario: Cell matching no rule shows default background
    Then a Duration cell with value 1.8s has no background color

  Scenario: Text color remains unchanged
    Then all Duration cells retain their default text color regardless of background tint

  Scenario: Background tint adapts to dark mode
    Given the user switches to dark mode
    Then matching cells use low-opacity dark-mode semantic tokens for their background


# ─────────────────────────────────────────────────────────────────────────────
# VISUAL RENDERING — GROUP HEADER STATS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Conditional formatting on group headers
  Group header aggregate stats receive conditional formatting when rules exist.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has a saved lens with grouping active
    And the lens has Duration formatting rules: red > 5s, yellow > 2s, green < 1s

  Scenario: Group header aggregate matches a formatting rule
    Given the "llama-70b" group has an average Duration of 6.3s
    Then the Duration stat in the "llama-70b" group header has a red background tint

  Scenario: Group header aggregate does not match any rule
    Given the "gpt-4o" group has an average Duration of 1.2s
    Then the Duration stat in the "gpt-4o" group header has no background color

  Scenario: Scanning group headers reveals problems at a glance
    Then each group header's aggregate stats are individually evaluated against the formatting rules


# ─────────────────────────────────────────────────────────────────────────────
# VISUAL RENDERING — COLUMN HEADER INDICATOR
# ─────────────────────────────────────────────────────────────────────────────

Feature: Conditional formatting column header indicator
  Columns with formatting rules show colored dot indicators in the header.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has a saved lens with a trace table visible

  Scenario: Column with formatting rules shows colored dots
    Given the Duration column has red and yellow formatting rules
    Then the Duration column header shows a red dot and a yellow dot next to the column name

  Scenario: Column with all three rule colors shows three dots
    Given the Duration column has red, yellow, and green formatting rules
    Then the Duration column header shows three colored dots

  Scenario: Column without formatting rules shows no dots
    Given the Tokens column has no formatting rules
    Then the Tokens column header shows no colored dots


# ─────────────────────────────────────────────────────────────────────────────
# CREATING RULES — ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

Feature: Conditional formatting entry point
  Users access conditional formatting via column header context menu.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has a saved lens with a trace table visible

  Scenario: Right-clicking a numeric column header shows format option
    When the user right-clicks the "Duration" column header
    Then the context menu includes "Format column..."

  Scenario: Column header overflow menu shows format option
    When the user clicks the overflow menu on the "Cost" column header
    Then the menu includes "Format column..."

  Scenario: Non-numeric column header does not show format option
    When the user right-clicks the "Model" column header
    Then the context menu does not include "Format column..."

  Scenario: Clicking format option opens the formatting popover
    When the user clicks "Format column..." for the "Duration" column
    Then the formatting popover opens for the "Duration" column


# ─────────────────────────────────────────────────────────────────────────────
# CREATING RULES — FORMATTING POPOVER
# ─────────────────────────────────────────────────────────────────────────────

Feature: Conditional formatting popover
  The formatting popover lets users define threshold rules for a column.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has a saved lens with a trace table visible
    And the user opened the formatting popover for "Duration"

  Scenario: Popover shows the column name
    Then the popover title reads "Format: Duration"

  Scenario: Color order is fixed
    Then the rule rows are ordered red first, then yellow, then green

  Scenario: Operator dropdown offers three choices
    When the user clicks the operator dropdown on a rule row
    Then the options are "greater than", "less than", and "between"

  Scenario: Selecting between operator shows a second value input
    When the user selects the "between" operator on a rule row
    Then a second numeric value input appears for the upper boundary

  Scenario: Value input shows unit label matching the column
    Then the value input shows "s" as the unit label for Duration

  Scenario: Cost column value input shows dollar unit
    Given the user opened the formatting popover for "Cost"
    Then the value input shows "$" as the unit label

  Scenario: Tokens column value input shows no unit label
    Given the user opened the formatting popover for "Tokens"
    Then the value input shows no unit label

  Scenario: Add rule button adds a new rule row
    Given there is one rule row
    When the user clicks "+ Add rule"
    Then a second rule row appears

  Scenario: Add rule button disappears when all three colors are used
    Given there are three rule rows using red, yellow, and green
    Then the "+ Add rule" button is not visible

  Scenario: Apply saves rules to the lens
    When the user adjusts the rule values and clicks "Apply"
    Then the rules are saved to the lens's LensConfig
    And the popover closes

  Scenario: Apply puts the lens into draft state
    When the user clicks "Apply"
    Then the lens enters draft state with a dot indicator

  Scenario: Clear all removes all rules and closes the popover
    When the user clicks "Clear all"
    Then all formatting rules for the column are removed
    And the popover closes

  Scenario: Escape closes the popover without saving
    When the user presses Escape
    Then the popover closes
    And no changes are saved


# ─────────────────────────────────────────────────────────────────────────────
# CREATING RULES — PRE-POPULATED DEFAULTS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Conditional formatting pre-populated defaults
  Columns with no existing rules suggest sensible defaults when opened.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has a saved lens with a trace table visible

  Scenario: Duration column suggests default thresholds
    Given the Duration column has no existing formatting rules
    When the user opens the formatting popover for "Duration"
    Then the popover is pre-filled with red > 5s, yellow > 2s, green < 1s

  Scenario: Cost column suggests default thresholds
    Given the Cost column has no existing formatting rules
    When the user opens the formatting popover for "Cost"
    Then the popover is pre-filled with red > $0.10, yellow > $0.01

  Scenario: Tokens column suggests default thresholds
    Given the Tokens column has no existing formatting rules
    When the user opens the formatting popover for "Tokens"
    Then the popover is pre-filled with red > 10000, yellow > 5000

  Scenario: TTFT column suggests default thresholds
    Given the TTFT column has no existing formatting rules
    When the user opens the formatting popover for "TTFT"
    Then the popover is pre-filled with red > 2s, yellow > 1s

  Scenario: Defaults are not applied until the user clicks Apply
    Given the user opens the formatting popover for "Duration" with no existing rules
    Then the default values are shown but not yet applied to the table

  Scenario: Clicking Apply with unchanged defaults uses the defaults
    Given the user opens the formatting popover for "Duration" with no existing rules
    When the user clicks "Apply" without modifying the pre-filled values
    Then the default rules are applied to the column

  Scenario: User can adjust defaults before applying
    Given the user opens the formatting popover for "Duration" with no existing rules
    When the user changes the red threshold from 5 to 10
    And the user clicks "Apply"
    Then the red rule is saved with value 10

  Scenario: Column with existing rules does not show defaults
    Given the Duration column already has formatting rules
    When the user opens the formatting popover for "Duration"
    Then the existing rules are shown, not the defaults


# ─────────────────────────────────────────────────────────────────────────────
# REMOVING RULES
# ─────────────────────────────────────────────────────────────────────────────

Feature: Removing conditional formatting rules
  Users can remove individual rules or clear all rules for a column.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has a saved lens with a trace table visible
    And the Duration column has red, yellow, and green formatting rules

  Scenario: Removing a single rule via the popover
    When the user opens the formatting popover for "Duration"
    And the user clicks the remove button on the yellow rule row
    And the user clicks "Apply"
    Then only the red and green rules remain for Duration

  Scenario: Clear all removes all rules via the popover
    When the user opens the formatting popover for "Duration"
    And the user clicks "Clear all"
    Then all formatting rules for Duration are removed

  Scenario: Clear formatting via column header context menu
    When the user right-clicks the "Duration" column header
    And the user clicks "Clear formatting"
    Then all formatting rules for Duration are removed

  Scenario: Removing rules on one lens does not affect other lenses
    Given "Lens B" also has formatting rules for Duration
    When the user removes formatting rules for Duration on the current lens
    Then "Lens B" still has its formatting rules for Duration


# ─────────────────────────────────────────────────────────────────────────────
# INTERACTION WITH LENSES
# ─────────────────────────────────────────────────────────────────────────────

Feature: Conditional formatting lens interaction
  Formatting rules are stored per-lens and follow lens lifecycle.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has a saved lens with a trace table visible

  Scenario: Adding rules puts the lens into draft state
    When the user adds formatting rules to a column
    Then the lens shows a draft state dot indicator

  Scenario: Editing rules puts the lens into draft state
    Given the lens has existing formatting rules
    When the user modifies a rule threshold
    Then the lens shows a draft state dot indicator

  Scenario: Removing rules puts the lens into draft state
    Given the lens has existing formatting rules
    When the user removes a formatting rule
    Then the lens shows a draft state dot indicator

  Scenario: Rules are saved as part of LensConfig
    When the user saves the lens
    Then the formatting rules are persisted in the LensConfig's conditionalFormatting array

  Scenario: Built-in lens with formatting requires save-as
    Given the user is viewing a built-in lens
    When the user adds formatting rules
    Then the lens enters draft state
    And the user must "Save as new lens" to keep the formatting

  Scenario: New lens creation captures current formatting rules
    Given the lens has formatting rules applied
    When the user creates a new lens from the current state
    Then the new lens includes the current formatting rules


# ─────────────────────────────────────────────────────────────────────────────
# INTERACTION WITH GROUPING
# ─────────────────────────────────────────────────────────────────────────────

Feature: Conditional formatting with grouping
  Formatting applies to both individual rows and group header aggregates.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has a saved lens with grouping by model active
    And the lens has Duration formatting rules: red > 5s, yellow > 2s, green < 1s

  Scenario: Individual trace rows are formatted within groups
    Then each trace row's Duration cell is evaluated against the formatting rules

  Scenario: Group header aggregate value is formatted
    Given the "llama-70b" group has an average Duration of 6.3s
    Then the aggregate Duration stat in the group header has a red background tint

  Scenario: Grouped by model with duration formatting reveals slow models
    Given the "gpt-4o" group has an average Duration of 1.2s
    And the "llama-70b" group has an average Duration of 6.3s
    Then scanning the group headers shows "llama-70b" highlighted in red
    And "gpt-4o" has no Duration highlighting


# ─────────────────────────────────────────────────────────────────────────────
# DATA GATING
# ─────────────────────────────────────────────────────────────────────────────

Feature: Conditional formatting data gating
  Edge cases for null, estimated, hidden, and zero values.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has a saved lens with a trace table visible
    And the lens has Cost formatting rules: red > $0.10, yellow > $0.01

  Scenario: Null or missing values do not match any rule
    Given a trace has no Cost data and the cell shows a dash
    Then the Cost cell has no background color

  Scenario: Estimated values are evaluated using the estimated value
    Given a trace has an estimated Cost of $0.15 displayed with a tilde prefix
    Then the Cost cell has a red background tint
    And the tilde prefix remains visible

  Scenario: Hidden column preserves rules but does not evaluate them
    Given the Cost column has formatting rules
    When the user hides the Cost column
    Then the formatting rules are preserved in the LensConfig
    And the rules are not evaluated while the column is hidden

  Scenario: Re-showing a hidden column restores formatting
    Given the Cost column was hidden and had formatting rules
    When the user re-shows the Cost column
    Then the formatting rules are applied again

  Scenario: Zero value is evaluated normally against rules
    Given a trace has a Cost of $0.00
    And there is a green rule for Cost with operator "<" and value 0.01
    Then the Cost cell with value $0.00 matches the green rule


# ─────────────────────────────────────────────────────────────────────────────
# PERFORMANCE
# ─────────────────────────────────────────────────────────────────────────────

Feature: Conditional formatting performance
  Formatting is evaluated client-side with negligible overhead.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has a saved lens with a trace table visible

  Scenario: Formatting is evaluated client-side only
    When the table renders with formatting rules
    Then no additional server queries are made for conditional formatting

  Scenario: Formatting evaluates per-cell during render
    Given the table has 50 rows and 3 columns with formatting rules
    Then 150 cell evaluations occur during render with negligible performance impact

  Scenario: Group header formatting uses server-provided aggregates
    Given grouping is active with formatting rules
    Then the aggregate stats from the server are formatted client-side
    And no additional server queries are made


# ─────────────────────────────────────────────────────────────────────────────
# KEYBOARD AND ACCESSIBILITY
# ─────────────────────────────────────────────────────────────────────────────

Feature: Conditional formatting accessibility
  Formatted cells and column headers are accessible to screen readers.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has a saved lens with a trace table visible
    And the lens has Duration formatting rules: red > 5s

  Scenario: Screen reader announces formatting status on a formatted cell
    When a screen reader focuses a Duration cell with value 6.3s formatted as red
    Then the screen reader announces the value and the formatting status including the color and threshold context

  Scenario: Screen reader announces formatting rules on column header
    Given the Duration column has conditional formatting rules
    When a screen reader focuses the Duration column header
    Then the screen reader announces that the column has conditional formatting rules
