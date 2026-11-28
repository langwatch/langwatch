Feature: Sorting the Admin users list
  An operator orders the users list by any of its columns. The server orders the
  whole result set, search included, before it pages, so page two continues page one.
  Organizations and Projects order by how many each user has; Status orders
  Active, Unverified, Pending SSO, Deactivated.

  @unit
  Scenario: The users list refuses a sort field it does not know
    Given an operator holding the view grant
    When they ask for the users list sorted by a field that is not a column
    Then the read is refused with validation_error naming the sort field
    And the repository is never asked

  @integration
  Scenario: The users list is ordered across every page before it is paged
    Given users with different names, organization counts, project counts and statuses
    When an operator asks for the users list sorted by a column in either direction
    Then the rows come back in that column's order across pages
    And users with no value for the column come last in both directions
    And Status orders Active, Unverified, Pending SSO, then Deactivated whatever else is set
    And a search narrows the rows without changing their order

  @integration
  Scenario: Clicking a column header sorts the users table
    Given an operator on the Admin users page
    When they click a column header
    Then the list is asked sorted by that column ascending and the header shows an up arrow
    When they click the same header again
    Then the list is asked sorted descending and the header shows a down arrow
    When they click it a third time
    Then the list returns to newest first
    And the sort is kept in the address, so a reload keeps it
