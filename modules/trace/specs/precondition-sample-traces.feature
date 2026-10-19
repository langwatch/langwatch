@trace @preconditions
Feature: A check's try-it-out sample
  As someone configuring a check
  I want a sample of recent traces marked by whether the check would run on them
  So that I can see what my preconditions let through before I save the check

  @unit
  Scenario: Traces passing the preconditions come first
    Given sampled traces of which some pass the check's preconditions
    When traces.getSampleTraces is called
    Then the passing traces come first, marked as passing

  @unit
  Scenario: Fewer than ten passing traces are topped up with ones that do not pass
    Given sampled traces of which fewer than ten pass the check's preconditions
    When traces.getSampleTraces is called for more results than pass
    Then the sample is topped up to the expected results with non-passing traces, marked as not passing

  @unit
  Scenario: No sampled traces answers an empty sample
    Given no traces in the requested range
    When traces.getSampleTraces is called
    Then the sample is empty and the preconditions are not matched
