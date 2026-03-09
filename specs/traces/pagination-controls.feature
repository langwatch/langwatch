@traces @pagination
Feature: Traces tab pagination controls
  As a LangWatch user
  I want working pagination controls on the Traces tab
  So that I can browse through all my traces beyond the first page

  # ─── Design Context ────────────────────────────────────────────────
  #
  # The Traces tab supports two pagination modes:
  #   1. Offset-based: default mode, uses pageOffset + pageSize URL params
  #   2. Cursor-based: uses scrollId for deep pagination (10k+ results)
  #
  # Pagination state is managed via URL query parameters (pageOffset,
  # pageSize, scrollId) so that page state survives refresh and sharing.
  #
  # The NavigationFooter component renders:
  #   - "Items per page" dropdown (10, 25, 50, 100, 250)
  #   - Page position indicator ("1-25 of 500 items")
  #   - Previous/Next page buttons
  #
  # The useNavigationFooter hook reads URL params and provides
  # nextPage, prevPage, and changePageSize functions that update
  # the URL via shallow router.push.
  #
  # Bug: pagination controls (items per page and next page) are
  # non-functional — changing page size or clicking next does not
  # update the trace list. This affects both list and table views.
  # ─────────────────────────────────────────────────────────────────

  Background:
    Given I am on the Traces tab for my project
    And the project has at least 50 traces

  # ─── Items Per Page ─────────────────────────────────────────────

  @e2e
  Scenario: Changing items per page reloads the trace list with new size
    Given the default page size of 25 is active
    When I change the "Items per page" dropdown to 10
    Then the trace list displays exactly 10 traces
    And the displayed traces are a subset of the original 25

  @integration
  Scenario: Changing items per page updates URL parameters
    Given the current URL has no pageSize parameter
    When I change the "Items per page" dropdown to 50
    Then the URL query parameter "pageSize" is set to "50"
    And the "pageOffset" query parameter is absent

  @integration
  Scenario: Changing items per page resets to first page
    Given I am on page 2 with pageOffset 25
    When I change the "Items per page" dropdown to 10
    Then the pageOffset is reset to 0
    And the trace list reloads from the beginning

  @integration
  Scenario: Page size persists across page reload
    Given I have changed the page size to 50
    When I reload the page
    Then the "Items per page" dropdown shows 50
    And the trace list displays at most 50 traces

  # ─── Next Page Navigation ───────────────────────────────────────

  @e2e
  Scenario: Navigating to the next page shows different traces
    Given the trace list shows the first 25 traces
    When I click the "next page" button
    Then the trace list shows a different set of traces
    And the page position indicator shows "26-50"

  @integration
  Scenario: Next page button updates URL offset
    Given the current pageOffset is 0 and pageSize is 25
    When I click the "next page" button
    Then the URL query parameter "pageOffset" is set to "25"

  @integration
  Scenario: Next page button is disabled on the last page
    Given the total number of traces is 30
    And the page size is 25
    And I am on page 2 (pageOffset 25)
    Then the "next page" button is disabled

  # ─── Previous Page Navigation ───────────────────────────────────

  @integration
  Scenario: Previous page button is disabled on the first page
    Given the pageOffset is 0
    Then the "previous page" button is disabled

  @integration
  Scenario: Navigating back to the previous page
    Given I am on page 2 with pageOffset 25
    When I click the "previous page" button
    Then the "pageOffset" query parameter is absent
    And the trace list reloads showing the first page

  # ─── Page Position Indicator ────────────────────────────────────

  @integration
  Scenario: Page position indicator shows correct range
    Given the pageOffset is 0 and pageSize is 25 and totalHits is 100
    Then the page position indicator shows "1-25 of 100 items"

  @integration
  Scenario: Page position indicator adjusts on the last page
    Given the pageOffset is 75 and pageSize is 25 and totalHits is 90
    Then the page position indicator shows "76-90 of 90 items"

  # ─── Cursor-Based Pagination (Deep Pagination) ─────────────────

  @integration
  Scenario: Cursor pagination displays page estimate
    Given cursor-based pagination is active via a scrollId in the URL
    Then the page position indicator shows "Page N of ~M (X total items)"
    And the previous page button label says "Go to first page"

  @integration
  Scenario: Previous page in cursor mode resets to first page
    Given cursor-based pagination is active via a scrollId in the URL
    When I click the "previous page" button
    Then the scrollId is removed from the URL
    And the pageOffset is reset to 0
    And offset-based pagination resumes

  # ─── Query/Filter Interaction ───────────────────────────────────

  @unit
  Scenario: Changing search query resets pagination to defaults
    Given the pageOffset is 50 and pageSize is 100
    When the search query changes
    Then the pageOffset is reset to 0
    And the pageSize is reset to the default of 25

  @unit
  Scenario: Page size dropdown reflects current URL parameter
    Given the URL has pageSize set to 100
    When the NavigationFooter renders
    Then the dropdown value is "100"

  # ─── Filter Interaction ────────────────────────────────────────

  @integration
  Scenario: Applying a filter resets pagination to first page
    Given I am on page 2 with pageOffset 25
    When I apply a filter from the sidebar
    Then the pageOffset is reset to 0
