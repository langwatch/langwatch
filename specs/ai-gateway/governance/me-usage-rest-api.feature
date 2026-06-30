Feature: Personal usage REST API
  As a developer (or a desktop/menu-bar widget acting on my behalf)
  I want a stable REST endpoint that returns my personal AI spend and usage
  So that I can read the same numbers the /me dashboard shows without scraping tRPC

  Background:
    Given I authenticate with an API key from my personal workspace

  Scenario: Reading personal usage for the current month
    When I GET /api/me/usage
    Then the response status is 200
    And the body has a "summary" object with spend, billed spend, request and token counts, and the most-used model
    And the body has a "dailyBuckets" array of per-day spend and request counts
    And the body has a "breakdownByModel" array of per-model spend and request counts

  Scenario: Reading personal usage for an explicit window
    When I GET /api/me/usage with a start and end time
    Then the response status is 200
    And the rollups cover only usage that falls inside the requested window

  Scenario: A half-specified window is rejected
    When I GET /api/me/usage with only a start time (or only an end time)
    Then the response status is 400
    And the error explains both bounds must be provided together

  Scenario: An inverted window is rejected
    When I GET /api/me/usage with a start time at or after the end time
    Then the response status is 400
    And the error explains the start must be before the end

  Scenario: Empty state is safe
    Given my personal workspace has no usage in the window
    When I GET /api/me/usage
    Then the response status is 200
    And the spend is 0 and there is no most-used model
    And every daily bucket shows zero spend and the per-model breakdown is empty

  Scenario: A shared-workspace API key is rejected
    Given I authenticate with an API key from a shared (non-personal) workspace
    When I GET /api/me/usage
    Then the response status is 400
    And the error explains a personal-workspace API key is required

  Scenario: Unauthenticated requests are rejected
    Given I provide no API key
    When I GET /api/me/usage
    Then the response status is 401
