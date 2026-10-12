Feature: Annotation score metric options
  Reviewers configure the choices available for an annotation score and may
  mark one choice as the default.

  @integration @regression
  Scenario: Clicking an option marks it as the default
    Given an annotation score metric uses multiple-choice options
    When the user clicks the radio beside an option
    Then that radio is selected
    And the option is shown as the default
