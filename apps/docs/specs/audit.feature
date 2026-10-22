Feature: Audit the built documentation for search, agents and page quality

  Every docs change is held to the same bar before it ships: each published
  page can be found, cited and read by people, search engines and agents, and
  representative pages stay fast and accessible. Budgets live in one committed
  file, so raising or relaxing the bar is a reviewed change.

  @unit
  Scenario: Report every search and agent-readiness gap across all pages
    Given a build whose sitemap lists its navigable pages
    When the static audit reads every listed page
    Then a page without exactly one top-level heading is reported
    And a page whose title or description is missing or outside the budgeted length is reported
    And a page whose canonical address is missing, relative or not its sitemap address is reported
    And a page missing its social title, description or absolute image is reported
    And a page whose structured data does not parse is reported
    And a navigable page marked noindex is reported
    And a page without a nonempty Markdown export, or missing from llms.txt, is reported
    And each report names the page and the exact gap

  @unit
  Scenario: Let crawlers in and point them at the sitemap
    Given a build's robots.txt and not-found page
    When the static audit reads them
    Then robots.txt that blocks the documentation or names no sitemap is reported
    And a not-found page that search engines may index is reported

  @unit
  Scenario: Hold Lighthouse results to the committed budgets
    Given Lighthouse results for a page on mobile and desktop
    When they are compared with the committed budgets
    Then a category score below its budget fails the audit
    And layout shift, transferred bytes or request count over budget fails the audit
    And a failing accessibility, best-practice or search audit fails unless the page lists it as known, with a reason
    And a page Lighthouse could not load fails the audit
    But a known failure that no longer fails is reported so the budget can be tightened

  @unit
  Scenario: Summarise the audit for the pull request
    Given an audit with scores, metrics and budget failures
    When the summary is written
    Then a table shows each page's scores, paint timings, blocking time, layout shift, bytes and requests per device
    And each budget failure is listed with its page and device

  @e2e
  Scenario: Audit representative pages in a real browser
    Given a production build served under /docs with compressed responses, as a CDN serves it
    When the audit runs Lighthouse on the home page, a guide with code and tabs, a long page with diagrams and images, an API operation, a section index and the not-found page
    Then each runs on mobile and desktop, a few at a time
    And Markdown exports are served as text/markdown
    And the run fails when any budget or static check fails
