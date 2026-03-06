Feature: Suite empty state for suites with no runs
  As a user who just created a suite
  I want to see a clear empty state when there are no runs
  So that I know what to do next instead of seeing a blank or broken page

  @integration
  Scenario: Empty state displays when suite has no runs
    Given a suite exists with no runs
    When I view the suite detail page
    Then I see an empty state message indicating no runs exist
    And I see a call-to-action guiding me to run my first batch

  @integration
  Scenario: Empty state disappears when runs exist
    Given a suite exists with at least one run
    When I view the suite detail page
    Then I do not see the empty state message
    And I see the run results

  @integration
  Scenario: Empty state does not appear when runs exist but are filtered out
    Given a suite exists with runs outside the selected time period
    When I view the suite detail page with a narrow time filter
    Then I do not see the onboarding empty state with the run CTA
    And I see a message that no runs exist in the selected time period
