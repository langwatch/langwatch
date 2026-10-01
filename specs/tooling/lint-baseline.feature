Feature: There is no lint suppression list
  Debt for cognitive-complexity, condition-shape, max-depth and complexity once
  lived as ~2,400 hand-edited filenames spread across oxlint config overrides.
  That became one ledger, packages/architecture-enforcer/src/oxlint-baseline.json,
  keyed `rule|file` with a `measured` date and a shrink-only check, which was a
  real improvement on what it replaced.

  It is now gone, and the reason is what it grew into. The ledger held 6,925
  `rule|file` rows hiding 8,904 findings, and hid them in a way nothing could
  see or bound:

    - A key carried no count, and `isBaselined` was a set lookup, so a file on
      the list was exempt from that rule however many NEW violations it gained.
      The shrink-only check could not catch this: it refused new KEYS, and
      growth inside a key already present adds none.
    - No entry carried an `expires`, and the reader the rules consult did not
      read that field at all, so nothing ever came back on its own.
    - It blocked its own repair. A wave that met a baselined INTERFACE stopped
      at it, correctly, leaving the flagged implementations unfixable by whoever
      found them.
    - Two rules, `no-nested-ternary` and `shared-setup-is-a-hook`, had every
      occurrence suppressed, so they enforced nothing anywhere while reading as
      clean.

  The count went from 6,403 to 15,514 the day it was deleted. That number is the
  point: it was always the real one. A rule now either runs everywhere or is
  turned off by name in the configuration, where a reader can see it.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A rule reports every finding, in every file
    Given a file that fails a rule and was previously listed in the suppression ledger
    When that rule runs over the file
    Then it reports the finding
    And no file is exempt from a rule it fails

  @unit
  Scenario: There is no suppression ledger to read
    Given the repository as it stands
    When the oxlint baseline path is looked for
    Then no such file exists
    And nothing in the linter reads one

  Rule: A rule is enabled or disabled by name, never per file

    @unit
    Scenario: The nested ternary rule is enabled workspace-wide
      Given the oxlint configuration
      When its workspace-wide rules are read
      Then the built-in no-nested-ternary rule is enabled

    @unit
    Scenario: No langwatch rule is turned off for a path
      Given the architecture configuration
      When its override blocks are read
      Then no langwatch rule is switched off for any path
      And a rule the repository does not enforce is turned off workspace-wide instead

  Rule: A block that names files and calls itself temporary is a register

    # The ledger was deleted and a second one was found the same day, inline in
    # the architecture config, headed DEBT REGISTER and switching a rule off for
    # nine named paths -- one of them listed twice, which is how you can tell
    # nobody had read it since writing it. An exception that belongs to a design
    # says what the exempt files ARE; a register says the exemption is
    # temporary. That difference is what this checks, and it checks it only for
    # blocks naming exact paths, because naming a category is the legitimate form.

    @unit
    Scenario: No configuration block defers debt by naming files
      Given the oxlint configuration
      When every block that turns a rule off for named files is read
      Then none of them describes its own exemption as temporary

    @unit
    Scenario: The deferred-debt check reports a register rather than passing it
      Given the register that was removed from the architecture configuration
      When the deferred-debt check reads it
      Then it reports the register and names a file the register held

  Rule: Test files get a looser tier, by category and never by filename

    # The looser test tier was deleted on 2026-09-17. It switched six rules off
    # for every test file, and stand-in-cast alone accounted for 1,856 findings
    # nobody could see -- the largest single concealment in the tree. A test is
    # still allowed to be blunt, but that is now argued finding by finding and
    # driven to zero, not granted wholesale to a category.
    @unit
    Scenario: The readability and stand-in tiers are enforced in tests too
      Given a test file that fails stand-in-cast, condition-shape, comment-block-size, cognitive-complexity or no-inline-dynamic-import
      When those rules run over it
      Then each one is reported
      And no override block relaxes them for tests

    # Relaxing a rule that only ever fires in tests is not leniency, it is
    # deleting the rule. These stay on.
    @unit
    Scenario: The rules written for tests stay enforced in tests
      Given a test file that fails test-description-is-an-action, shared-setup-is-a-hook, banned-test-model-names or unit-test-does-not-render
      When those rules run over it
      Then each one still reports
