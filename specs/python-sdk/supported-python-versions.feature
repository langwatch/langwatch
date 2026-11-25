Feature: Supported Python versions

  The published package declares the interpreter range it supports through
  requires-python. A cap below a Python version people already run does not
  fail the install: pip walks back to the newest release that accepts the
  interpreter, so the user silently gets an old version and only finds out
  when a function added since then is missing.

  The guard is the test suite itself. It runs on every interpreter in the
  declared range, and on each one it checks that the metadata claims that
  interpreter. A cap that excludes a version CI runs fails there instead of
  reaching PyPI.

  @unit
  Scenario: The declared range accepts the interpreter running the tests
    Given the package declares a requires-python range
    When the suite runs on an interpreter
    Then that interpreter's version falls inside the declared range

  @unit
  Scenario: Every minor version in the declared range has a classifier
    Given the package declares a requires-python range
    When the classifiers are read
    Then there is one Python classifier per minor version in the range
