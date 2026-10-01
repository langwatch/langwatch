# A process that fails before it can log a structured line at all — a missing
# named export, a package Node cannot resolve, a boot exception thrown before
# any try/catch runs — used to reach the terminal as Node's own multi-line
# dump: no level, one rendered line per stack frame, the fact that mattered
# (which module, which export, which file and line) buried in the middle of
# it. See specs/setup/dev-stack-log-format.feature ("A process that cannot
# boot prints one fatal record with its stack") for the WRITE side of the
# format — a process that catches its own failure already writes one JSON
# record with the trace as one string field. That part was never the problem.
#
# The problem was the renderer: even a correctly-written record was shown as
# a header line plus one indented continuation line per stack frame, which
# reads as a wall of text no different from the crash it replaced. This
# feature is the supervisor's own layer on top of that record: it collapses
# the stack — written or raw — down to the message plus the first frame
# inside this repository, keeps the full trace out of the rendered stream,
# and still gets it somewhere a developer can read it in full.
#
# `dev/scripts/dev-supervisor.mjs` owns this for the Node lane it watches
# (ADR-004 amendment, 2026-09-07): it is what holds the child's stdout and
# stderr open, so it is the one place that can see a crash forming before the
# process exits and the raw text is gone. `tools/thuishaven`'s own restart
# loop (`adapters/procsupervisor`) owns the second half: under haven a crash
# that does not get fixed restarts forever, and printing the same fatal line
# once per restart is the same wall of text on a timer.

Feature: A crashing Node lane renders as one fatal line
  As a developer reading the backend lane's boot output
  I want a crash to be one line naming what broke and where
  So that I can act on it without scrolling past a raw stack trace

  # --- Collapsing a record that already caught its own failure ---

  @unit
  Scenario: A caught boot exception renders as one line, not a header plus a trace
    Given a process that wrote one fatal record with a stack trace
    When the supervisor forwards it
    Then the rendered line carries the message and the first frame inside the repository
    And no continuation line follows it
    And the full trace is written to the lane's crash log, not the rendered stream

  # --- Node's own crash shapes, which never reach a try/catch ---

  @unit
  Scenario: A missing named export is one fatal line naming the module and the export
    Given a child that fails to boot because a module does not export a name it imports
    When the supervisor sees it exit
    Then one fatal line is rendered naming the module, the missing export and the importing file and line
    And the raw multi-line dump is written to the lane's crash log, not the rendered stream

  @unit
  Scenario: A missing package is one fatal line naming the package and the importer
    Given a child that fails to boot because Node cannot resolve an imported package
    When the supervisor sees it exit
    Then one fatal line is rendered naming the package and the file that imported it
    And the raw multi-line dump is written to the lane's crash log, not the rendered stream

  @unit
  Scenario: An uncaught exception is one fatal line naming the error and the first application frame
    Given a child that throws before it can catch its own failure
    When the supervisor sees it exit
    Then one fatal line is rendered naming the error's message and the first stack frame inside the repository
    And frames under node_modules and Node's own internals are skipped when choosing that frame

  # --- The escape hatch ---

  @unit
  Scenario: LANGWATCH_DEV_RAW_CRASH=1 shows the raw output instead of collapsing it
    Given a child that crashes with a recognised shape
    When the supervisor runs with LANGWATCH_DEV_RAW_CRASH=1
    Then the raw output reaches the rendered stream unchanged
    And nothing is collapsed into a synthesized line

  # --- The restart loop, under haven ---

  # Plain `pnpm dev` never restarts a crashed lane (concurrently
  # --kill-others-on-fail takes the whole stack down instead, deliberately —
  # see dev-stack-lifecycle.feature), so this only happens under haven, whose
  # own supervisor restarts any exited lane after a backoff forever.
  @unit
  Scenario: The restart line itself renders at warn, not with no level
    Given a lane that exited and is about to be restarted
    When haven's supervisor logs the restart
    Then the line renders at level warn

  @unit
  Scenario: A repeated identical crash is rendered once with a counter
    Given a lane that keeps crash-looping on the same unfixed cause
    When it crashes a second and third time with the same fatal message
    Then the second and third occurrences render as one short line with a restart count
    And neither repeats the full message or the location a second time

  @unit
  Scenario: A different crash after a repeat is rendered in full again
    Given a lane that crash-looped once on one cause
    When it then crashes on a different cause
    Then the new failure is rendered in full, not folded into the previous counter
