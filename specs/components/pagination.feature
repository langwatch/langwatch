Feature: Numbered pagination bar
  As a reader working through a long table
  I want a numbered pager and a plain description of what I am looking at
  So that I can jump to any page, change how many rows I see, and never
  confuse the page size with a page number

  Background:
    Given a table whose rows are read one page at a time

  Rule: The pager offers numbered pages, not just arrows

    @integration
    Scenario: The pager lists page numbers and elides the ones it skips
      Given a list of 500 rows read 50 at a time
      When the pagination bar is shown
      Then the first pages are offered as numbers
      And the last page is offered as a number
      And the pages left out in between are replaced by an ellipsis

    @integration
    Scenario: Choosing a page number opens that page
      Given a list of 500 rows read 50 at a time
      When I choose page 4
      Then the table is asked for page 4

    @integration
    Scenario: The page I am on is marked as the current one
      Given a list of 500 rows read 50 at a time and I am on page 3
      When the pagination bar is shown
      Then page 3 is announced as the current page

    @integration
    Scenario: Back is unavailable on the first page
      Given a list of 500 rows read 50 at a time and I am on the first page
      When the pagination bar is shown
      Then Back cannot be used

  Rule: The bar says in words what is on screen

    @integration
    Scenario: The bar names the total, the range shown and the page size
      Given a list of 7949 traces read 50 at a time and I am on the first page
      When the pagination bar is shown
      Then it reads that there are 7,949 traces
      And it reads that rows 1 to 50 are showing
      And it offers 50 as the number of rows per page

    @integration
    Scenario: The total is left out when the rows have no name
      Given a list of rows whose noun the table does not supply
      When the pagination bar is shown
      Then no total is claimed
      And the range showing is still named

    @integration
    Scenario: Changing rows per page hands the caller the new size
      Given a list of 500 rows read 50 at a time and I am on page 3
      When I change rows per page to 100
      Then the table is asked to read 100 rows at a time

  Rule: Pages the data source cannot reach are offered but not clickable

    @integration
    Scenario: A page the data source cannot open is shown disabled
      Given a list whose rows can only be reached in order
      And only the first two pages have been reached
      When the pagination bar is shown
      Then page 2 can be opened
      And page 5 cannot be opened

    @integration
    Scenario: Next is unavailable once the data source has no further rows
      Given a list whose rows can only be reached in order
      And the data source reports no rows after the current page
      When the pagination bar is shown
      Then Next cannot be used

    @integration
    Scenario: Next follows the cursor when only the cursor knows the next page
      Given a trace list on its first page and a cursor for the next one
      When I click Next
      Then the cursor is filed under the page it opens
      And the reader moves to that page

    @integration
    Scenario: Jumping past the reached pages reads by position instead
      Given a trace list on its first page
      When I choose a page far ahead of the one I am on
      Then the reader moves to that page without a cursor
      And the list is read from that page's position

    # Reading by position pays for every skipped row, so its depth is capped
    # at 100,000 rows; cursor steps are keyset reads and pay nothing, so Next
    # keeps working past the cap.
    @unit
    Scenario: A position read past the window is refused
      Given a trace list read by position
      When a page is requested whose rows sit past the first 100,000
      Then the read is refused
      And the reader is told to narrow the range or page forward

    @integration
    Scenario: Page numbers past the position window are offered but not clickable
      Given a trace list far larger than the position window
      When the pagination bar is shown
      Then a page past the window cannot be opened by number
      And the page after the current one still can, through its cursor

  Rule: The bar keeps out of the way when there is nothing to page

    @integration
    Scenario: Nothing renders when there are no rows
      Given a list with no rows at all
      When the table finishes loading
      Then no pagination bar is shown

    @integration
    Scenario: A placeholder holds the bar's place while the first page loads
      Given a list whose first page is still loading
      When the pagination bar is shown
      Then a placeholder stands in for the description of the page
      And the pager keeps rendering with its controls disabled
