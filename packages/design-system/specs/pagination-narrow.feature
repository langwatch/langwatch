Feature: Pagination on narrow screens
  A table footer with many pages stays one short row of controls on a phone,
  and keeps its wide layout on a desktop.

  @integration @browser @responsive
  Scenario: Pagination fits a phone-width screen on one line under its summary
    Given a known-total pagination of 1,424 rows at 50 per page with a page-size picker, centred or end-aligned
    When it renders on a 390px wide screen
    Then the summary and the page-size picker sit above the pager
    And Back, the first pages, the last page and Next sit on one line
    And the pager ends before the bottom-right corner where the floating assistant button sits
    And nothing overflows the bar horizontally

  @integration @browser @responsive
  Scenario: Pagination keeps one row with neighbouring pages on a wide screen
    Given a known-total pagination of 1,424 rows at 50 per page with a page-size picker
    When it renders on a 1400px wide screen
    Then the summary and the pager share one row
    And the pager shows two neighbouring pages on each side of the current page
