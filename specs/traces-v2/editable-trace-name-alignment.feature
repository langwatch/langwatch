# Editable trace name — alignment while renaming
#
# Implementation:
#   langwatch/src/features/traces-v2/components/TraceDrawer/drawerHeader/EditableTraceName.tsx
#   langwatch/src/features/traces-v2/components/TraceDrawer/drawerHeader/DrawerHeader.tsx  (status orb / StatusChip sibling)
#
# Motivation (round 5): clicking to rename the trace drops the inline
# input AND, below it, a character counter (and any validation message).
# Those below-input elements add height to the editor column; because the
# header row centres its children vertically (`align="center"`), the
# status orb sibling re-centres against the now-taller column and slides
# toward the bottom — the orb visibly desyncs from the name baseline the
# moment editing starts.

Feature: Editable trace name alignment

  # Context: the user is viewing an authenticated session with the trace
  # drawer open, showing the trace name and its status orb. Each scenario
  # below states that precondition explicitly.

  Scenario: Status orb stays aligned with the name when renaming starts
    Given the user is authenticated with "traces:view" permission
    And the trace drawer is open showing the trace name and its status orb
    When the user clicks to rename the trace
    Then the inline name input appears
    And the status orb stays vertically aligned with the name input
    And it does not drop toward the bottom of the header row

  Scenario: The character counter does not shift the orb
    Given the user is authenticated with "traces:view" permission
    And the trace drawer is open showing the trace name and its status orb
    And the trace is being renamed
    When the character counter is shown beneath the input
    Then the counter does not change the vertical alignment of the orb and input row
    # The counter / validation message must not contribute to the height
    # the header row centres against (e.g. it overlays or is excluded from
    # the centred row rather than stacking inside it).

  Scenario: Alignment is restored after editing ends
    Given the user is authenticated with "traces:view" permission
    And the trace drawer is open showing the trace name and its status orb
    And the trace is being renamed
    When the user commits or cancels the rename
    Then the status orb and name return to their resting aligned position
