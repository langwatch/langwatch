Feature: Every ratchet is the same file, read by the same code
  As an author who has to move an architecture debt inventory
  I want one baseline shape, one reader and one writer
  So that a row means the same thing whichever policy holds it

  Background:
    Given a baseline is a JSON file of version 1 naming the policy that owns it
    And each row is a key in that policy's own grammar, the date it was measured,
    an optional review date and an optional count the shrink check compares
    And the rows are sorted by key in code-unit order

  @unit @architecture
  Scenario: Every ratchet reads through one shape
    Given a baseline file whose rows are sorted, dated and unique
    When the shared reader reads it for its policy
    Then it returns the rows and refuses nothing

  @unit @architecture
  Scenario: An out-of-order or duplicated file is refused before it is read
    Given a baseline file whose rows are out of order, or name the same key twice
    When the shared reader reads it for its policy
    Then the file is refused by name, and the refusal repeats the policy's key rule
    And no row of that file exempts anything on that run

  @unit @architecture
  Scenario: A file that is not the one shape is refused by name
    Given a baseline file that is not version 1, or carries a row with no measured date,
    or names a policy other than the one reading it
    When the shared reader reads it for its policy
    Then the file is refused, and the refusal says which of the three it is

  @unit @architecture
  Scenario: An emptied ratchet is deleted, not kept
    Given a baseline file whose last row has been removed
    When the policy that owns it checks the workspace
    Then the run refuses the empty file rather than keeping it as an exception surface

  @unit @architecture
  Scenario: A row no live finding matches is reported as stale
    Given a baseline row whose key matches nothing the policy found
    When the policy that owns it checks the workspace
    Then the row is reported as a finding under that policy's baseline name
    And the finding carries the stale field, so the report counts it without reading its prose

  @unit @architecture
  Scenario: An expired row is refused where the policy enforces its date
    Given a baseline row whose review date has passed
    When the policy that owns it checks the workspace
    Then the row is refused where that policy enforces the date
    And it is left alone where that policy only lets the file shrink

  @unit @architecture
  Scenario: An expired row is refused once, not twice
    Given a baseline row that has both expired and stopped matching anything
    When the policy that owns it checks the workspace
    Then the row is refused as expired and not reported a second time as stale

  @unit @architecture
  Scenario: An expired row stops exempting what it once allowed
    Given a baseline row whose review date has passed
    When the policy asks which keys still exempt a finding
    Then the expired row's key is not among them

  @unit @architecture
  Scenario: A shrink check refuses a key the merge base did not carry
    Given a baseline compared with the copy on the merge base
    When the file has gained a key
    Then the run refuses the added key in the owning policy's own words
    And a file that has only lost keys is accepted

  @unit @architecture
  Scenario: A shrink check refuses a raised count and a postponed date
    Given a baseline whose rows carry a count or a review date
    When a row's count is raised, or its review date moved later
    Then the run refuses the growth
    And a lowered count or an earlier date is accepted

  @unit @architecture
  Scenario: A collected baseline keeps the date an existing row carries
    Given a fresh measurement of what a policy finds
    When the rows are collected against the file already checked in
    Then a key that was already listed keeps the date it was measured on
    And a key that is new carries today's date
    And a review date survives only where the policy acts on one

  @unit @architecture
  Scenario: One writer, one stable output
    Given a set of baseline rows in any order
    When the one writer formats them
    Then the output names the version and the policy, sorts the rows by key,
    and reads back through the reader unchanged

  @unit @architecture
  Scenario: A ratchet whose inventory reached zero becomes a plain refusal
    Given a policy whose baseline file has been deleted after reaching zero rows
    When that policy checks the workspace
    Then it refuses every offending file outright
    And it reads no file, so a fixture tree without one behaves like the workspace
