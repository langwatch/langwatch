# Live Tail — Gherkin Spec
# Covers: connection lifecycle, stream behavior, filtering, controls, status bar,
#         trace rows, drawer integration, navigation, loading states, data gating,
#         accessibility

# ─────────────────────────────────────────────────────────────────────────────
# IMPLEMENTATION STATUS (audited 2026-05-01)
# ─────────────────────────────────────────────────────────────────────────────
# There is no `/live-tail` route, no LiveTail page component, no Pause /
# Resume / Clear controls, no traces-per-minute status bar, no settings
# popover, no sound-alert toggle, and no "View in Observe" affordance.
#
# What DOES exist on the regular Observe page (and powers the same "new
# data is here" idea):
#   - `useTraceFreshness` — opens a tRPC SSE subscription via
#     `useTraceUpdateListener` and invalidates list / facets / drawer
#     queries when `trace_summary_updated` / `span_stored` events arrive.
#   - `useTraceNewCount` — polls `tracesV2.newCount` with adaptive
#     backoff when SSE is connecting/disconnected.
#   - `NewTracesScrollUpIndicator` — renders an orb-shaped "N new"
#     button after the user scrolls down past 80px; clicking scrolls
#     to top and acknowledges the new count.
#   - `sseStatusStore` — tracks `connecting | connected | disconnected
#     | error` connection state.
#
# Nothing visualises a live indicator dot, paused state, sampling
# warning, or the per-row "absolute timestamp + service + cost" compact
# layout described below. Filters do NOT stream server-side; they
# refetch via the standard list query.
#
# The whole feature is tagged `@planned` until either (a) a dedicated
# Live Tail page ships or (b) the spec is rewritten to describe the
# Observe-page freshness affordances.

@planned
Feature: Live tail
  # Not yet implemented as of 2026-05-01.
  # Observe page has SSE-driven cache invalidation + a "scroll up to see
  # N new" indicator (`NewTracesScrollUpIndicator` + `useTraceNewCount`),
  # but there is no separate Live Tail page, no pause/resume/clear,
  # and no streaming server-side filter. Scenarios below describe the
  # design-doc roadmap, not the shipped behaviour.

Rule: Live Tail connection
  The Live Tail page establishes a real-time streaming connection when opened
  and tears it down when the user navigates away.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has existing traces

  Scenario: Connection opens when the page loads
    When the user navigates to the Live Tail page
    Then a streaming connection is established to the server
    And the status bar shows a green pulsing "Live" indicator

  Scenario: Connection closes when navigating away
    Given the Live Tail page is open and streaming
    When the user navigates to the Observe page
    Then the streaming connection is closed
    And no background resource usage remains

  Scenario: Automatic reconnection on connection drop
    Given the Live Tail page is open and streaming
    When the connection drops unexpectedly
    Then the status bar shows "Connection lost. Reconnecting..."
    And the page reconnects automatically with backoff
    And previously displayed traces remain visible during reconnection

  Scenario: Failed connection shows retry option
    Given the Live Tail page is open
    When the connection fails after reconnection attempts
    Then the page shows "Failed to connect to live stream."
    And a "Retry" button is visible


# ─────────────────────────────────────────────────────────────────────────────
# STREAM BEHAVIOR
# ─────────────────────────────────────────────────────────────────────────────

Rule: Live Tail stream behavior
  New traces stream into the list in real-time, with buffering and rate limiting
  to keep the UI responsive at high throughput.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the Live Tail page is open and streaming

  Scenario: New traces appear at the top of the list
    When a new trace arrives
    Then it is inserted at the top of the trace list
    And older traces shift down

  Scenario: Auto-scroll when user is at the top
    Given the user is at the top of the trace list
    When new traces arrive
    Then they auto-insert with a smooth animation
    And the user remains at the top of the list

  Scenario: Auto-scroll pauses when user scrolls down
    Given the user has scrolled down to inspect older traces
    When new traces arrive
    Then the list does not scroll
    And a banner appears showing the count of new traces

  Scenario: Clicking the new traces banner scrolls to top
    Given the user has scrolled down
    And the new traces banner is visible
    When the user clicks the new traces banner
    Then the list scrolls to the top
    And new traces resume auto-inserting

  Scenario: Buffer holds the last 500 traces
    Given more than 500 traces have arrived
    Then only the most recent 500 traces are kept in memory
    And the oldest traces are removed from the bottom of the list

  Scenario: High volume batching at more than 50 traces per second
    When traces arrive faster than 50 per second
    Then traces are batched and inserted in chunks every 200 milliseconds
    And a "high volume" indicator is shown

  Scenario: Reduced motion disables slide animation
    Given the user has "prefers-reduced-motion" enabled
    When new traces arrive
    Then they appear instantly without slide animation


# ─────────────────────────────────────────────────────────────────────────────
# FILTERING
# ─────────────────────────────────────────────────────────────────────────────

Rule: Live Tail filtering
  Filters use the same search syntax as the Observe page and apply to
  the stream in real-time.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the Live Tail page is open and streaming

  Scenario: Filtering by status
    When the user types "@status:error" in the search bar
    Then only traces with error status appear in the stream
    And non-matching traces are excluded

  Scenario: Filtering by service
    When the user types "@service:finance-bot" in the search bar
    Then only traces from the "finance-bot" service appear

  Scenario: Filtering by model
    When the user types "@model:gpt-4o" in the search bar
    Then only traces using the "gpt-4o" model appear

  Scenario: Free text search
    When the user types a free text query in the search bar
    Then only traces matching the text appear

  Scenario: Combining multiple filters
    When the user types "@status:error @service:finance-bot" in the search bar
    Then only error traces from the "finance-bot" service appear

  Scenario: Filters apply server-side to reduce payload
    When the user sets a filter
    Then the filter is sent to the server
    And the server streams only matching traces

  Scenario: No filter sidebar is shown
    When the Live Tail page is open
    Then no filter sidebar is visible
    And only the search bar is available for filtering


# ─────────────────────────────────────────────────────────────────────────────
# CONTROLS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Live Tail controls
  Pause, clear, and settings controls for managing the live stream.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the Live Tail page is open and streaming

  Scenario: Pausing the stream
    When the user clicks the Pause button
    Then the stream stops displaying new traces
    And the button changes to "Resume" with a count of buffered traces
    And the status bar shows "Paused" with a yellow indicator

  Scenario: Resuming the stream flushes the buffer
    Given the stream is paused
    And traces have been buffering
    When the user clicks the Resume button
    Then all buffered traces are inserted into the list
    And the stream resumes displaying new traces in real-time
    And the status bar shows the green "Live" indicator

  Scenario: Clearing the trace list
    When the user clicks the Clear button
    Then all traces are removed from the list
    And the stream continues
    And new traces appear as they arrive

  Scenario: Settings popover opens
    When the user clicks the settings gear icon
    Then a settings popover appears

  Scenario: Toggling column visibility in settings
    Given the settings popover is open
    When the user toggles a column off
    Then that column is hidden from the trace list
    And when toggled back on it reappears

  Scenario: Sound alert on errors
    Given the settings popover is open
    When the user enables "Sound alert on errors"
    And an error trace arrives
    Then an audible alert plays

  Scenario: Sound alert on errors is off by default
    When the settings popover is opened for the first time
    Then "Sound alert on errors" is off

  Scenario: Auto-pause when drawer opens is on by default
    When the settings popover is opened for the first time
    Then "Auto-pause when drawer opens" is on


# ─────────────────────────────────────────────────────────────────────────────
# STATUS BAR
# ─────────────────────────────────────────────────────────────────────────────

Rule: Live Tail status bar
  A fixed status bar at the bottom shows real-time stream metrics.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the Live Tail page is open and streaming

  Scenario: Status bar shows live metrics
    Then the status bar is fixed at the bottom of the page
    And it shows the live indicator, traces per minute, errors per minute, and average duration

  Scenario: Metrics use a rolling one-minute window
    When traces have been flowing for more than one minute
    Then traces per minute reflects the last 60 seconds of activity
    And errors per minute reflects the last 60 seconds of errors
    And average duration reflects the last 60 seconds of trace durations

  Scenario: Metrics update every five seconds
    Given the stream is active
    When five seconds elapse
    Then the status bar metrics refresh

  Scenario: Status bar shows paused state
    When the user pauses the stream
    Then the live indicator changes to "Paused" with a yellow dot


# ─────────────────────────────────────────────────────────────────────────────
# TRACE ROWS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Live Tail trace rows
  Trace rows use compact single-line format with absolute timestamps.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the Live Tail page is open and streaming
    And traces are visible in the list

  Scenario: Row displays correct columns
    Then each trace row shows timestamp, root span name, service, duration, cost, and status
    And the timestamp is in absolute format with milliseconds

  Scenario: Rows use compact density
    Then each trace row uses compact single-line layout
    And no I/O preview rows are shown

  Scenario: Error rows have a red left border
    When an error trace is in the list
    Then that row has a subtle red left border

  Scenario: Clicking a row opens the trace drawer
    When the user clicks a trace row
    Then the trace drawer opens showing the full trace detail


# ─────────────────────────────────────────────────────────────────────────────
# DRAWER INTEGRATION
# ─────────────────────────────────────────────────────────────────────────────

Rule: Live Tail drawer integration
  The trace drawer opens from Live Tail rows and auto-pauses the stream
  to prevent the list from jumping while reading.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the Live Tail page is open and streaming
    And traces are visible in the list

  Scenario: Drawer auto-pauses the stream by default
    When the user clicks a trace row to open the drawer
    Then the stream pauses automatically
    And the Pause button changes to Resume with buffered count

  Scenario: Closing the drawer resumes the stream
    Given the drawer is open and the stream was auto-paused
    When the user closes the drawer
    Then the stream resumes

  Scenario: Drawer shows full trace detail
    When the user opens the trace drawer
    Then the drawer shows the same visualization, tabs, and accordions as the Observe page drawer

  Scenario: Arrow keys navigate between traces in the drawer
    Given the trace drawer is open
    When the user presses the Down arrow key
    Then the drawer shows the next trace in the live tail list
    And when the user presses the Up arrow key the drawer shows the previous trace

  Scenario: Auto-pause can be disabled in settings
    Given the user has disabled "Auto-pause when drawer opens" in settings
    When the user clicks a trace row to open the drawer
    Then the stream continues running
    And new traces keep arriving in the list behind the drawer

  Scenario: Focus moves to drawer on open
    When the user clicks a trace row to open the drawer
    Then focus moves to the drawer

  Scenario: Focus returns to the row when drawer closes
    Given the trace drawer is open
    When the user closes the drawer
    Then focus returns to the trace row that was selected


# ─────────────────────────────────────────────────────────────────────────────
# NAVIGATION
# ─────────────────────────────────────────────────────────────────────────────

Rule: Live Tail navigation
  Live Tail is a sibling page to Observe with its own route and
  independent filter state.

  Background:
    Given the user is authenticated with "traces:view" permission

  Scenario: Live Tail is accessible from the nav bar
    When the user views the navigation bar
    Then "Live Tail" is visible as a clickable nav item next to "Observe"

  Scenario: Live Tail has its own route
    When the user navigates to the Live Tail page
    Then the URL path is "/live-tail"

  Scenario: Filters do not carry over from Observe
    Given the user has active filters on the Observe page
    When the user navigates to Live Tail
    Then the search bar is empty
    And no filters are applied

  Scenario: View in Observe link opens trace in main page
    Given a trace row is visible in Live Tail
    When the user clicks "View in Observe" on a trace
    Then the trace opens in the main Observe page for historical context


# ─────────────────────────────────────────────────────────────────────────────
# LOADING STATES
# ─────────────────────────────────────────────────────────────────────────────

Rule: Live Tail loading states
  Different visual states are shown as the connection progresses from
  connecting through to active streaming.

  Background:
    Given the user is authenticated with "traces:view" permission

  Scenario: Connecting state shows spinner
    When the Live Tail page is loading
    Then the page shows "Connecting to live stream..." with a spinner

  Scenario: Connected with no traces yet
    Given the connection is established
    And no traces have arrived yet
    Then the page shows "Waiting for traces... Stream is live." with a pulsing dot

  Scenario: Connected with traces flowing
    Given the connection is established
    And traces are arriving
    Then the normal trace list view is shown

  Scenario: Disconnected state shows reconnection countdown
    When the connection is lost
    Then the page shows "Connection lost. Reconnecting..." with a retry countdown

  Scenario: Connection error shows retry button
    When the connection fails permanently
    Then the page shows "Failed to connect to live stream."
    And a "Retry" button is available


# ─────────────────────────────────────────────────────────────────────────────
# DATA GATING
# ─────────────────────────────────────────────────────────────────────────────

Rule: Live Tail data gating
  Handles edge cases: empty projects, empty filter results, and very
  high volume streams.

  Background:
    Given the user is authenticated with "traces:view" permission

  Scenario: Empty project shows onboarding with live tail message
    Given the project has zero traces
    When the user opens the Live Tail page
    Then the onboarding empty state is shown
    And an additional message reads "Once traces arrive, they'll appear here in real-time."

  Scenario: Filters match nothing
    Given the Live Tail page is open and streaming
    When the user applies a filter that matches no traces
    Then the page shows "No traces matching current filters"
    And a link to clear filters is visible
    And the stream continues running silently in the background

  Scenario: Very high volume triggers sampling indicator
    Given the Live Tail page is open and streaming
    When traces arrive at more than 100 per second
    Then a rate-limited indicator is shown
    And it reads "Sampling: showing 1 in N traces at current volume."


# ─────────────────────────────────────────────────────────────────────────────
# ACCESSIBILITY
# ─────────────────────────────────────────────────────────────────────────────

Rule: Live Tail accessibility
  Keyboard navigation, screen reader support, and reduced motion
  handling for the live stream.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the Live Tail page is open and streaming
    And traces are visible in the list

  Scenario: Keyboard navigation of trace rows
    When the user presses the Down arrow key
    Then focus moves to the next trace row
    And when the user presses the Up arrow key focus moves to the previous row

  Scenario: Enter key opens the trace drawer
    Given a trace row is focused
    When the user presses Enter
    Then the trace drawer opens

  Scenario: Escape key closes the drawer
    Given the trace drawer is open
    When the user presses Escape
    Then the drawer closes

  Scenario: P key toggles pause and resume
    When the user presses the "P" key
    Then the stream pauses
    And when the user presses "P" again the stream resumes

  Scenario: C key clears the list
    When the user presses the "C" key
    Then all traces are removed from the list

  Scenario: Status bar is announced to screen readers
    Then the status bar has an aria-live polite region
    And the new trace count is announced every 10 seconds
    And individual trace arrivals are not announced

  Scenario: Pause and resume state is announced to screen readers
    When the user pauses or resumes the stream
    Then the state change is announced to screen readers
