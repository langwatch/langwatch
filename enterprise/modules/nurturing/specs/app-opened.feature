Feature: App opens reach Customer.io on the opening user

  Auth records an app-opened fact when a person with a browser login session
  opens the sessions page. Nurturing tells Customer.io about that person's own
  profile, at most once an hour per user across every pod.

  @unit
  Scenario: An app open identifies app_last_opened_at and tracks sessions_page_viewed on the opening user
    When auth records an app open for user-1
    Then Customer.io identifies user-1 with app_last_opened_at
    And tracks sessions_page_viewed on user-1

  @unit
  Scenario: Only the sessions page raises sessions_page_viewed
    When auth records an app open for a page other than the sessions page
    Then app_opened is raised and sessions_page_viewed is not

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
