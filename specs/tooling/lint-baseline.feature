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
    Scenario: Turning a rule off is a visible configuration choice
      Given a rule the repository does not want to enforce
      When it is turned off
      Then it is turned off by name in the oxlint configuration
      And it is not turned off for a list of individual files

  Rule: Test files get a looser tier, by category and never by filename

    # A test has no trust boundary to parse at and no caller to protect, and its
    # job is to be blunt about setting up a situation. 6,210 of the 16,186
    # findings left after the ledger went were in test files. This is leniency
    # chosen once, in the open, for a category - not a list of paths.
    @unit
    Scenario: The readability and stand-in tiers are relaxed for tests
      Given a test file that fails stand-in-cast, condition-shape, comment-block-size, cognitive-complexity, empty-catch, no-inline-dynamic-import or no-nested-ternary
      When those rules run over it
      Then they report nothing
      But the same code in a production file is still reported

    # Relaxing a rule that only ever fires in tests is not leniency, it is
    # deleting the rule. These stay on.
    @unit
    Scenario: The rules written for tests stay enforced in tests
      Given a test file that fails test-description-is-an-action, shared-setup-is-a-hook, banned-test-model-names or unit-test-does-not-render
      When those rules run over it
      Then each one still reports
