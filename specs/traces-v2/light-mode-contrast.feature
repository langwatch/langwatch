# Trace explorer light-mode contrast
#
# Implementation:
#   langwatch/src/features/traces-v2/components/TracesPage/TracesPage.tsx
#   langwatch/src/features/traces-v2/components/TraceTable/TraceTableShell.tsx
#   langwatch/src/features/traces-v2/components/TraceDrawer/panes/*
#
# Motivation: in light mode the trace table rendered rows on a gray
# (`bg.muted`) container with a same-color header — operators reported the
# eye had nothing to anchor on. DevTools-style inversion (white rows, gray
# header) improves scannability. Dark mode is intentionally left alone.

Feature: Light-mode contrast inversion

Rule: Trace table — rows white, header gray (light mode only)
  # Background is descriptive prose only — every scenario inlines its
  # own Given steps so the runner doesn't depend on shared setup.

  Background:
    The trace table sits under a `<Box>` wrapper inside ResultsPane that
    used to render on a gray `bg.muted` surface with a same-color
    `bg.surface` `<thead>`. This rule covers the inversion: rows on
    white, headers on muted gray. Dark mode is intentionally untouched.

  Scenario: Table body wrapper renders on white in light mode
    Given the user is authenticated with "traces:view" permission
    And the user is in light mode
    When the trace table is visible
    Then the wrapping `ResultsPane` `<Box>` underneath the table renders
      on a white (`bg.surface`) background
    # Previously `bg="bg.muted"` — gray.

  Scenario: Column headers render on gray in light mode
    Given the user is authenticated with "traces:view" permission
    And the user is in light mode
    When the trace table is visible
    Then the `<thead>` row renders on a muted gray (`bg.muted`)
      background
    # Previously `bg="bg.surface"` — same as the body, no contrast.

  Scenario: Dark mode is unchanged
    Given the user is authenticated with "traces:view" permission
    And the user is in dark mode
    When the trace table is visible
    Then the table body and header backgrounds match the dark-mode design
      that operators already approve of


Rule: Drawer panes — content white, pane header gray (light mode only)
  # Background is descriptive prose only.

  Background:
    Drawer panes are wrapped by the new `<Pane>` primitive whose header
    uses `bg.muted` in light / `bg.subtle` in dark, and whose content
    area uses `bg.surface` in light / `bg.panel` in dark. The
    Conversation Context pane no longer wraps its content in an inner
    padded `bg.subtle` box (it doubled the gray in the previous layout).

  Scenario: Pane header bar uses a muted gray background
    Given the drawer is open in Trace mode
    And the user is in light mode
    Then each pane's header bar uses `bg.muted` in light mode
    And `bg.subtle` (or equivalent muted dark surface) in dark mode

  Scenario: Pane content area uses white in light mode
    Given the drawer is open in Trace mode
    And the user is in light mode
    Then each pane's content area uses `bg.surface` (white) in light mode
    And the dark-mode token (`bg.panel`) in dark mode

  Scenario: Conversation context loses its inner box padding
    Given the drawer is open in Trace mode
    And the user is in light mode
    And the trace belongs to a conversation
    Then the Conversation Context pane content fills the pane edge-to-edge
      (no inner padded gray box)
    # Previously rendered a `bg.subtle` block with its own padding inside
    # the drawer body, doubling up the gray.
