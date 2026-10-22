Feature: Audit how well the documentation serves coding agents

  Coding agents choose the vendor whose docs they can fetch cheaply, act on from
  the first paragraph and paste from without editing. Every docs pull request is
  scored on that, page by page, from the Markdown exports agents actually read.
  Today's gaps are listed as known in the committed budgets; a new gap fails the
  pull request, and a known gap that no longer occurs is reported so the list
  can shrink.

  @unit
  Scenario: Measure each page's Markdown export in tokens
    Given a page whose Markdown export is longer than the page token budget
    When the agent readiness audit reads it
    Then the page is reported with its approximate token count, counted as characters divided by four
    And the totals for llms.txt and llms-full.txt are reported with their largest contributors

  @unit
  Scenario: A page answers in its first paragraph
    Given pages whose Markdown exports open in different ways
    When the agent readiness audit reads them
    Then a page whose export carries no description is reported
    And a page with neither a description nor a prose paragraph before its first section heading is reported
    And a page whose description or first paragraph announces the page instead of answering, such as "In this guide we will", is reported
    But a page that opens with a callout and then a self-contained paragraph passes

  @unit
  Scenario: Integration pages are the ones the navigation files under integrations
    Given a docs.json whose navigation names framework, provider and SDK groups
    When the integration pages are resolved from the configured anchors, groups and pages
    Then every page under a configured group is an integration page, nested groups included
    And an explicitly listed page is an integration page
    And an excluded page is not

  @unit
  Scenario: An integration page gives one complete path from install to a first trace
    Given an integration page
    When the agent readiness audit reads it
    Then a page with no install command for a language its samples use is reported
    And a page that never names LANGWATCH_API_KEY is reported
    And a page without a complete, tagged code sample that imports what it uses is reported
    And a page without a step that tells the reader how to see that it worked is reported

  @unit
  Scenario: Code samples can be pasted as they are
    Given a page with code blocks
    When the agent readiness audit reads them
    Then a code block without a language tag is reported
    And a shell block whose commands start with a "$ " prompt is reported
    And a block made only of placeholders, ellipses and comments is reported
    And a Python, TypeScript or Go sample that calls the LangWatch SDK without importing it is reported
    But a one-line call fragment is not held to the import rule

  @unit
  Scenario: Components export as readable Markdown
    Given a page whose Markdown export still holds component tags or MDX statements outside code blocks
    When the agent readiness audit reads it
    Then the page is reported with the component names that leaked

  @unit
  Scenario: Agents can discover the documentation
    Given a build's discovery files and page heads
    When the agent readiness audit reads them
    Then a page missing from llms-full.txt is reported
    And a page head without the llms.txt, llms-full.txt, agent card or skills index link is reported
    And an agent card without a name, description, address or skills is reported
    And a skills index entry whose file is missing or whose digest does not match its bytes is reported
    And robots.txt that does not name each AI crawler, or blocks one, is reported

  @unit
  Scenario: Freshness is reported, not enforced
    Given a sitemap where some pages have no last-modified date
    When the agent readiness audit reads it
    Then the share of pages with a date is reported
    And a note says production builds need the full git history
    But no failure is raised for a missing date

  @unit
  Scenario: Known agent readiness gaps are tolerated and new ones fail
    Given gaps listed as known in the committed budgets
    When the audit compares today's gaps with them
    Then a gap on a page not listed for its check fails the audit
    And a known gap that no longer occurs is reported so the list can be tightened
    And writing the baseline lists exactly today's gaps, sorted

  @unit
  Scenario: Summarise agent readiness for the pull request
    Given an agent readiness result
    When the summary is written
    Then an "Agent readiness" section shows the score, each check's pass rate and the token totals
    And it lists the worst pages per check, the new gaps and the known gaps that can be removed
    And the result is written as JSON next to the other audit reports
