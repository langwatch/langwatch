@traces @pagination
Feature: Traces tab pagination controls
  As a LangWatch user
  I want working pagination controls on the Traces tab
  So that I can browse through all my traces beyond the first page

  # ─── Design Context ────────────────────────────────────────────────
  #
  # The Traces tab pages by CURSOR only.
  #
  # Offset paging was dropped when trace search moved to ClickHouse — deep
  # OFFSET degrades badly, and keyset paging replaced it. The `pageOffset`
  # parameter outlived the implementation: nothing read it, so a request
  # carrying one was answered with the first page and HTTP 200, and an export
  # that paged by offset repeated that page for as long as it ran (#6808).
  #
  # It is now rejected at the boundary rather than ignored, and the Traces tab
  # never sends one. `scrollId` is the whole mechanism:
  #
  #   - the response carries a `scrollId` when a full page came back
  #   - the absence of one is how "there is nothing after this" is said
  #   - going back replays cursors the session already walked; from the first
  #     of those, the cursor is dropped and the list returns to page one
  #
  # Pagination state lives in the URL (`pageSize`, `scrollId`) so a page
  # survives refresh and can be shared. A `pageOffset` left in an older
  # bookmarked URL is ignored rather than obeyed, so an old link opens on the
  # first page instead of erroring.
  #
  # Lists that genuinely page by offset — the experiments list, the audit log —
  # share the footer component but declare offset mode explicitly. The mode is
  # a caller's declaration, never inferred from what happens to be in the URL.
  # ─────────────────────────────────────────────────────────────────

  Background:
    Given I am on the Traces tab for my project
    And the project has more traces than fit on one page

  # ─── Cursor Navigation ──────────────────────────────────────────

  @integration @unimplemented
  Scenario: The first page requests no cursor
    When the Traces tab loads for the first time
    Then the trace search request carries no scrollId
    And it carries no pageOffset

  @integration @unimplemented
  Scenario: Navigating forward follows the cursor from the response
    Given the trace list is showing its first page
    When I click the "next page" button
    Then the scrollId from the previous response is put in the URL
    And no pageOffset appears in the URL

  @e2e @unimplemented
  Scenario: Navigating forward shows different traces
    Given the trace list is showing its first page
    When I click the "next page" button
    Then the trace list shows a different set of traces
    And none of them appeared on the previous page

  @integration @unimplemented
  Scenario: The next button is disabled when the response carries no cursor
    Given the trace list is showing the last page of results
    Then the "next page" button is disabled

  @integration @unimplemented
  Scenario: Going back returns to the previously walked page
    Given I have navigated forward twice
    When I click the "previous page" button
    Then the list returns to the page I came from
    And the page counter goes down by one

  @integration @unimplemented
  Scenario: Going back from the second page returns to the first
    Given I have navigated forward once
    When I click the "previous page" button
    Then the scrollId is removed from the URL
    And the trace list shows the first page again

  @integration @unimplemented
  Scenario: The previous button is disabled on the first page
    Given the trace list is showing its first page
    Then the "previous page" button is disabled

  # ─── A Rejected Offset ──────────────────────────────────────────

  @integration @unimplemented
  Scenario: An old bookmarked link carrying an offset opens on the first page
    Given a URL for the Traces tab containing a pageOffset of 25
    When I open that URL
    Then the trace list shows the first page
    And the request sent to trace search carries no pageOffset
    And no error is shown

  # ─── Items Per Page ─────────────────────────────────────────────

  @e2e @unimplemented
  Scenario: Changing items per page reloads the trace list with the new size
    Given the default page size of 25 is active
    When I change the "Items per page" dropdown to 10
    Then the trace list displays at most 10 traces

  @integration @unimplemented
  Scenario: Changing items per page starts the scroll over
    Given I have navigated forward at least once
    When I change the "Items per page" dropdown to 50
    Then the scrollId is removed from the URL
    And the trace list shows the first page at the new size

  @integration @unimplemented
  Scenario: Page size persists across a page reload
    Given I have changed the page size to 50
    When I reload the page
    Then the "Items per page" dropdown shows 50

  # ─── Position Indicator ─────────────────────────────────────────

  @integration @unimplemented
  Scenario: The first page states an exact range
    Given the page size is 25 and there are 100 matching traces
    And the trace list is showing its first page
    Then the position indicator reads "1-25 of 100 items"

  @integration @unimplemented
  Scenario: Later pages state an approximate position
    Given I have navigated forward once
    Then the position indicator names the page number
    And it describes the total number of pages as approximate

  # ─── Filter And Query Interaction ───────────────────────────────

  # Integration, not unit: observing this means rendering the hook against a
  # mocked router, which is a boundary. The existing test for this hook is
  # already useNavigationFooter.cursor.integration.test.ts.
  @integration @unimplemented
  Scenario: Changing the search query starts the scroll over
    Given I have navigated forward at least once
    When the search query changes
    Then the scrollId is removed from the URL
    And the page size returns to the default of 25

  @integration @unimplemented
  Scenario: Applying a filter starts the scroll over
    Given I have navigated forward at least once
    When I apply a filter from the sidebar
    Then the scrollId is removed from the URL
    And the trace list shows the first page of the filtered results

  @integration @unimplemented
  Scenario: Clearing filters starts the scroll over
    Given I have navigated forward at least once
    When I clear all filters
    Then the scrollId is removed from the URL
    And the trace list shows the first page of the unfiltered results
