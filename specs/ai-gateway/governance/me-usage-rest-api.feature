Feature: Personal usage REST API
  As a developer (or a desktop/menu-bar widget acting on my behalf)
  I want a stable REST endpoint that returns my personal AI spend and usage
  So that I can read the same numbers the /me dashboard shows without scraping tRPC

  Background:
    Given a personal project authenticated by its project API key
    And the project has isPersonal=true with an ownerUserId

  Scenario: Reading personal usage for the current month
    When I GET /api/me/usage
    Then the response status is 200
    And the body has a "summary" object with spentUsd, billedUsd, requests, promptTokens, completionTokens and mostUsedModel
    And the body has a "dailyBuckets" array of { day, spentUsd, billedUsd, requests }
    And the body has a "breakdownByModel" array of { label, spentUsd, billedUsd, requests }

  Scenario: Reading personal usage for an explicit window
    When I GET /api/me/usage with windowStartMs and windowEndMs query params
    Then the response status is 200
    And the rollups cover only the requested window

  Scenario: Empty state is safe
    Given the personal project has no usage in the window
    When I GET /api/me/usage
    Then the response status is 200
    And summary.spentUsd is 0 and mostUsedModel is null
    And dailyBuckets and breakdownByModel are empty arrays

  Scenario: A non-personal project key is rejected
    Given the API key belongs to a project where isPersonal is false
    When I GET /api/me/usage
    Then the response status is 400
    And the error explains a personal-project API key is required

  Scenario: Unauthenticated requests are rejected
    Given no Authorization header
    When I GET /api/me/usage
    Then the response status is 401
