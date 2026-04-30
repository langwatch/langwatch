# Multiplayer Presence — Gherkin Spec
# Based on PRD-016: Multiplayer Presence
# Covers: view-level presence, trace-level presence dots, drawer-level presence, span-level presence, interaction states, mock data

# ─────────────────────────────────────────────────────────────────────────────
# VIEW-LEVEL PRESENCE (PRESET TABS)
# ─────────────────────────────────────────────────────────────────────────────

Feature: Multiplayer presence

Rule: View-level presence in preset tab bar
  Shows teammate avatars for people on the same lens/preset, right-aligned in the tab bar.

  Background:
    Given the user is authenticated
    And the project has mock presence data with multiple team members

  Scenario: Avatars appear for teammates on the same preset
    Given Sarah, Alex, Mike, and Priya are on the "All Traces" preset
    When the user views the "All Traces" preset
    Then overlapping avatar circles appear right-aligned in the preset tab bar
    And each avatar shows the team member's initials in their assigned color

  Scenario: Avatars only show teammates on the current preset
    Given Sarah, Alex, Mike, and Priya are on the "All Traces" preset
    And Jordan is on the "Errors" preset
    When the user switches to the "Errors" preset
    Then only Jordan's avatar appears in the tab bar
    And Sarah, Alex, Mike, and Priya's avatars are not shown

  Scenario: Avatar sizing and overlap in tab bar
    Given multiple teammates are on the current preset
    When the avatars render in the tab bar
    Then each avatar circle is 22px
    And adjacent avatars overlap by 8px

  Scenario: Tooltip on individual avatar shows name and context
    Given Sarah is on the same preset as the user
    When the user hovers over Sarah's avatar in the tab bar
    Then a tooltip reads "Sarah Jensen — viewing this lens"

  Scenario: Max three visible avatars with overflow counter
    Given five teammates are on the same preset as the user
    When the avatars render in the tab bar
    Then three avatar circles are visible
    And an overflow counter reading "+2" appears after them

  Scenario: No avatars when user is alone on a preset
    Given no other teammates are on the "Conversations" preset
    When the user views the "Conversations" preset
    Then no avatars appear in the tab bar

  Scenario: Muted label accompanies the avatars
    Given teammates are on the same preset as the user
    When the avatars render in the tab bar
    Then the label "on this view" appears in muted text beside the avatars


# ─────────────────────────────────────────────────────────────────────────────
# TRACE-LEVEL PRESENCE (TABLE ROWS)
# ─────────────────────────────────────────────────────────────────────────────

Rule: Trace-level presence dots on table rows
  A colored dot appears on trace rows where someone has that trace open, with fan-out on hover.

  Background:
    Given the user is authenticated
    And the project has traces with mock presence data

  Scenario: Presence dot appears on a row when one person views that trace
    Given Priya is viewing trace-003
    When the trace table renders
    Then an 8px dot in Priya's color appears on the trace-003 row

  Scenario: Presence dot uses the first viewer's color when multiple viewers
    Given Sarah and Alex are both viewing trace-001
    When the trace table renders
    Then a single 8px dot in Sarah's color appears on the trace-001 row

  Scenario: Dot has a subtle glow effect
    Given someone is viewing a trace
    When the dot renders on that row
    Then the dot has a subtle box-shadow glow

  Scenario: Dot placement is left of the row before the timestamp
    Given someone is viewing a trace
    When the dot renders on that row
    Then the dot is positioned on the left side of the row before the timestamp column
    And the dot sits 8px inset from the left edge

  Scenario: No dot on rows where nobody is viewing
    Given no one is viewing trace-002
    When the trace table renders
    Then no presence dot appears on the trace-002 row

  Scenario: Fan-out on hover reveals individual avatars
    Given Sarah and Alex are both viewing trace-001
    When the user hovers over the presence dot on trace-001
    Then the dot fades out
    And individual 20px avatar circles for Sarah and Alex slide out horizontally

  Scenario: Fan-out animation uses spring easing with stagger
    Given multiple viewers are on a trace
    When the user hovers over the presence dot
    Then avatars animate with spring easing over approximately 200ms
    And each subsequent avatar staggers by 30ms

  Scenario: Tooltip on expanded avatar shows full name
    Given the user has hovered to expand avatars on a trace row
    When the user hovers over Sarah's expanded avatar
    Then a tooltip shows "Sarah Jensen"

  Scenario: Avatars collapse back on mouse leave
    Given the user has hovered to expand avatars on a trace row
    When the user moves the mouse away from the row
    Then the avatars slide back and collapse into the single dot

  Scenario: Fan-out does not affect row height or trigger table reflow
    Given the user hovers to expand avatars on a trace row
    When the avatars fan out
    Then the fan-out uses overlay positioning
    And the row height remains unchanged
    And no table reflow occurs

  Scenario: Presence dot coexists with error border on error rows
    Given someone is viewing a trace that has an error status
    When the trace row renders
    Then the 3px error border appears on the outermost left edge
    And the presence dot appears inside the row without overlapping the error border


# ─────────────────────────────────────────────────────────────────────────────
# DRAWER-LEVEL PRESENCE
# ─────────────────────────────────────────────────────────────────────────────

Rule: Drawer-level presence showing co-viewers
  When others have the same trace open, their avatars and "Also viewing" appear in the drawer header.

  Background:
    Given the user is authenticated
    And the project has traces with mock presence data

  Scenario: "Also viewing" appears when others have the same trace open
    Given Sarah and Alex are viewing trace-001
    When the user opens the drawer for trace-001
    Then avatars for Sarah and Alex appear in the drawer header
    And the label "Also viewing" appears beside the avatars

  Scenario: Only other viewers are shown, not the current user
    Given the user and Sarah are both viewing trace-001
    When the user opens the drawer for trace-001
    Then only Sarah's avatar appears in the drawer header
    And the user's own avatar does not appear

  Scenario: Avatar sizing and overlap in drawer header
    Given multiple other viewers have the same trace open
    When the drawer header renders
    Then each avatar circle is 20px
    And adjacent avatars overlap by 6px

  Scenario: "Also viewing" label styling
    Given others are viewing the same trace
    When the drawer header renders
    Then the "Also viewing" text appears in muted gray at 11px font size

  Scenario: Avatars positioned left of maximize and close buttons
    Given others are viewing the same trace
    When the drawer header renders
    Then the presence avatars and label appear in the header actions area
    And they are positioned to the left of the maximize and close buttons

  Scenario: No "Also viewing" when user is the only viewer
    Given no one else is viewing trace-002
    When the user opens the drawer for trace-002
    Then no presence avatars or "Also viewing" label appear in the drawer header


# ─────────────────────────────────────────────────────────────────────────────
# SPAN-LEVEL PRESENCE (INSIDE DRAWER)
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span-level presence dots inside the drawer
  Colored dots appear next to spans where someone is focused, with hover-to-reveal behavior.

  Background:
    Given the user is authenticated
    And the user has opened the drawer for trace-001
    And mock presence data assigns viewers to specific spans

  Scenario: Dot appears on a span where someone is focused
    Given Sarah is focused on the llm.openai.chat span
    When the span tree renders inside the drawer
    Then an 8px dot in Sarah's color appears on the llm.openai.chat span row

  Scenario: Dot is positioned before the expand/collapse toggle
    Given someone is focused on a span
    When the dot renders on that span row
    Then the dot is positioned before the expand/collapse toggle in the span tree

  Scenario: Different viewers on different spans each get their own dot
    Given Sarah is focused on span s1-llm1
    And Alex is focused on span s1-root
    When the span tree renders
    Then a dot in Sarah's color appears on span s1-llm1
    And a dot in Alex's color appears on span s1-root

  Scenario: No dot on spans where no one is focused
    Given no one is focused on the tool.fetch_report span
    When the span tree renders
    Then no presence dot appears on the tool.fetch_report span row

  Scenario: Hover on span dot reveals viewer avatars
    Given Sarah is focused on a span
    When the user hovers over the presence dot on that span
    Then the dot fans out to show Sarah's 20px avatar circle
    And a tooltip shows Sarah's full name

  Scenario: Multiple viewers on the same span fan out on hover
    Given Sarah and Alex are both focused on the same span
    When the user hovers over the presence dot on that span
    Then both avatars fan out horizontally with the same spring animation as trace rows


# ─────────────────────────────────────────────────────────────────────────────
# INTERACTION STATES
# ─────────────────────────────────────────────────────────────────────────────

Rule: Presence interaction states
  Presence indicators respond correctly to all edge cases and state transitions.

  Background:
    Given the user is authenticated
    And the project has mock presence data

  Scenario: Opening a trace that someone else is viewing triggers drawer presence
    Given Sarah is already viewing trace-001
    When the user opens the drawer for trace-001
    Then "Also viewing" with Sarah's avatar appears in the drawer header

  Scenario: Teammate leaving a trace removes their avatar
    Given Sarah is viewing trace-001
    When Sarah's presence entry is removed from mock data
    Then Sarah's avatar disappears from the trace-001 row dot and drawer header

  Scenario: Presence dot coexists with error status on a row
    Given someone is viewing a trace that has an error status
    When the trace row renders
    Then both the error left-border and the presence dot are visible
    And they do not overlap


# ─────────────────────────────────────────────────────────────────────────────
# MOCK DATA AND TEAM MEMBER COLORS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Mock data and team member color assignments
  Team member colors are distinct from span type colors and feel personal.

  Background:
    Given the project has mock presence data

  Scenario: Team member colors are distinct from span type colors
    Then Sarah's color is pink and not blue, green, purple, orange, yellow, gray, or red
    And Alex's color is teal and not blue, green, purple, orange, yellow, gray, or red
    And Mike's color is cyan and not blue, green, purple, orange, yellow, gray, or red
    And Priya's color is amber and not blue, green, purple, orange, yellow, gray, or red
    And Jordan's color is light purple and not the same purple used for agent spans

  Scenario: Presence assignments match the expected context
    Given the mock presence data is loaded
    Then Sarah is on "All Traces" preset viewing trace-001 focused on span s1-llm1
    And Alex is on "All Traces" preset viewing trace-001 focused on span s1-root
    And Mike is on "All Traces" preset with no trace open
    And Priya is on "All Traces" preset viewing trace-003
    And Jordan is on "Errors" preset with no trace open
