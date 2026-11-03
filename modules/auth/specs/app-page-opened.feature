Feature: Auth records an app-page-opened fact

  A person who opens the sessions page with a browser login session raises one
  fact for peers. A CLI or API-key caller, and a person who belongs to no
  organization yet, raise nothing.

  @unit
  Scenario: A browser session opening the page records the fact
    Given a person with a browser session and an organization membership
    When the page is opened
    Then one app-page-opened fact is recorded with the user, the page and the time

  @unit
  Scenario: A call without a browser session records nothing
    Given a caller with no browser session
    When the page is opened
    Then no fact is recorded

  @unit
  Scenario: An impersonated session records nothing
    Given an operator impersonating a person with a browser session and an organization
    When the page is opened
    Then no fact is recorded

  @unit
  Scenario: A person with no organization membership records nothing
    Given a person with a browser session and no organization membership
    When the page is opened
    Then no fact is recorded

  @unit
  Scenario: A failing record never fails the page open
    Given the lifecycle recorder rejects
    When the page is opened
    Then the call resolves

  @unit
  Scenario: The app-page-opened fact carries ids, the page and the time only
    Given the app-page-opened event schema
    Then its keys are tenantId, userId, page and occurredAt

  @unit
  Scenario: A repeated page open inside an hour is one event
    Given two opens of one page by one person inside the same UTC hour
    Then both carry one idempotency key
    And an open in the next hour carries another
