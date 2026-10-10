Feature: A nightly run catches codebase health regressions the next morning
  Type-check cost, reference-chain depth, emitted declaration size and
  architecture findings drift one commit at a time, and nobody sees the jump
  until the editor is slow. `.github/workflows/codebase-health.yml` measures
  them each night with `dev/scripts/codebase-health.mjs`, compares with the
  previous successful run's `health.json`, and raises a jump as an issue
  labelled `codebase-health`.

  @unit
  Scenario: The first run has nothing to compare with
    Given no previous health.json
    When the health of tonight's run is compared
    Then no breach is reported
    And the summary says there is no previous run

  @unit
  Scenario: A program whose instantiations rise past both thresholds is a breach
    Given a program with 400000 instantiations last night
    When it has 600000 tonight
    Then the program is reported as a breach
    But a program rising from 1000 to 90000 is not, being under the 100000 floor

  @unit
  Scenario: Total instantiations up more than ten per cent is a breach
    Given 1000000 instantiations in total last night
    When the total is 1150000 tonight
    Then the total is reported as a breach

  @unit
  Scenario: A longer reference chain is a breach
    Given a longest reference chain of 17 configs last night
    When it is 18 tonight
    Then the chain depth is reported as a breach

  @unit
  Scenario: Any new architecture finding is a breach
    Given 0 "peer-cycles" findings and 3 "cycles" findings last night
    When there is 1 "peer-cycles" finding and 4 "cycles" findings tonight
    Then both policies are reported as breaches
    But a policy whose count fell is not

  @unit
  Scenario: Declaration size up more than ten per cent, or a new large file, is a breach
    Given 10 MB of emitted declarations last night and no file over 200 KB
    When there are 11.5 MB tonight and one file of 250 KB
    Then the total size and the new large file are both reported as breaches

  @unit
  Scenario: A breach opens an issue when none is open
    Given tonight's comparison has a breach
    And no open issue carries the "codebase-health" label
    Then an issue titled "Codebase health: <date> regressions" is opened with the table

  @unit
  Scenario: A breach comments on the open issue
    Given tonight's comparison has a breach
    And issue 42 is open with the "codebase-health" label
    Then the table is posted as a comment on issue 42 and no new issue is opened

  @unit
  Scenario: No breach does nothing
    Given tonight's comparison has no breach
    Then no issue is opened and no comment is posted
