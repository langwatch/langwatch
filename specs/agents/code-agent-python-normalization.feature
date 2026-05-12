@unit
Feature: Code agent Python source normalization on save
  As a user of the code-agent editor
  I want pasted Python to be normalised before it is saved
  So that accidental Monaco-paste indentation does not break Black at execute time

  # Background
  # Monaco's paste handler often inherits a common leading indent (for
  # example, every line gets two spaces) when the user pastes a Python
  # snippet that was originally indented inside a class or function.
  # The Python runtime later runs `black.format_str` on the stored
  # source (langwatch_nlp/langwatch_nlp/studio/parser.py); Black then
  # raises `InvalidInput: Cannot parse: 3:0:   class Code(dspy.Module):`
  # and the scenario UI surfaces an opaque HTTP 500 from
  # /studio/execute_sync. See issue #3013.
  #
  # The fix runs a `textwrap.dedent`-equivalent normalisation pass on
  # every code-agent save (create + update + replica push + sync) so
  # the stored source always starts at column 0.

  Scenario: Saving a code agent strips a common leading indent
    Given a user is creating a code agent
    And the pasted Python source has two spaces of common leading indent on every non-blank line
    When the user saves the agent
    Then the persisted code parameter has no common leading indent
    And the top-level class declaration is at column 0

  Scenario: Saving a code agent preserves an already-normalised source
    Given a user is creating a code agent
    And the pasted Python source has no common leading indent
    When the user saves the agent
    Then the persisted code parameter is byte-for-byte unchanged

  Scenario: Updating a code agent normalises the new source
    Given a code agent exists
    When the user edits the code and the new value has a common leading indent
    And the user saves the change
    Then the persisted code parameter has no common leading indent

  Scenario: Non-code agents are unaffected
    Given a user is creating an HTTP agent
    When the user saves the agent
    Then the persisted config is byte-for-byte unchanged by the normalisation pass
