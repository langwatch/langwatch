Feature: App opens reach Customer.io on the opening user

  Auth records an app-opened fact when a person with a browser login session
  opens the sessions page, the personal overview, or a usage, cost or plan page. Nurturing tells
  Customer.io about that person's own profile, at most once an hour per user
  across every pod. PostHog plays no part, so an ad blocker does not hide it.

  @unit
  Scenario: An app open identifies app_last_opened_at and tracks sessions_page_viewed on the opening user
    When auth records an app open for user-1
    Then Customer.io identifies user-1 with app_last_opened_at in Unix seconds
    And tracks sessions_page_viewed on user-1

  @unit
  Scenario: Repeated opens inside an hour send once per user
    When the same user opens the page twice inside an hour
    Then one identify and one track are sent
    And after the hour both are sent again

  @unit
  Scenario: Two pods opening for one user send once
    Given two delivery services share one claim repository
    When both deliver an open for the same user
    Then one sessions_page_viewed is tracked

  @unit
  Scenario: A refreshing tab sends one page-opened mutation an hour
    When the sessions page opens twice inside an hour in one browser
    Then one page-opened mutation is sent

  @unit
  Scenario: A usage, cost or plan page open identifies usage_page_viewed_at on the opening user
    When auth records an open of the personal overview, or of a usage, cost or plan page, for user-1
    Then Customer.io identifies user-1 with usage_page_viewed_at in Unix seconds

  @unit
  Scenario: The first usage, cost or plan page open tracks one usage_page_viewed
    When user-1 opens a usage, cost or plan page for the first time
    Then usage_page_viewed is tracked once on user-1

  @unit
  Scenario: Later usage, cost or plan page opens only move the timestamp
    Given user-1 opened such a page more than a year ago
    When user-1 opens one again
    Then usage_page_viewed_at moves to the later open
    And no second usage_page_viewed is tracked

  @unit
  Scenario: Opens of different usage, cost or plan pages inside an hour send one update
    When user-1 opens the usage page and then the plans page inside an hour
    Then one usage_page_viewed_at identify is sent
    And after the hour the next open sends another

  @unit
  Scenario: Other pages do not set usage_page_viewed_at
    When auth records an open of the sessions page for user-1
    Then no usage_page_viewed_at is identified
    And no usage_page_viewed is tracked

  @unit
  Scenario: A usage, cost or plan page open reaches Customer.io without PostHog
    When a usage, cost or plan page open is delivered
    Then PostHog is sent nothing

  @integration
  Scenario: Each usage, cost or plan screen announces its open through the page-opened mutation
    When a person opens the usage, plans, subscription or costs screen
    Then that screen records its own page opened

  @integration
  Scenario: The personal overview announces its open as a usage page
    When a person opens /me
    Then the screen records me_overview

  @integration
  Scenario: A billing screen announces nothing until the deployment is known to be hosted
    Given a self-hosted deployment, or one that has not answered yet
    When a person opens the usage, plans or subscription screen
    Then no page opened is recorded
