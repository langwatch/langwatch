Feature: The lint rule fixture workspace
  A rule test runs against a throwaway workspace rather than the real
  repository, so renaming a feature cannot break the lint suite. The fixture
  must write the same file shapes the rules read in production, or a test
  passes against a catalogue no rule can understand.

  @unit
  Scenario: The catalogue option writes the shape the rules read
    Given a fixture workspace whose catalogue names a feature's subjects
    When the catalogue file is read back
    Then it carries a version and a features list of id and subjects

  @unit
  Scenario: An empty catalogue is still a readable catalogue file
    Given a fixture workspace created with no catalogue
    When the catalogue file is read back
    Then it carries a version and an empty features list
