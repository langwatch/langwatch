Feature: Gateway list routes bound the page size

  Every unbounded list on the gateway management surface takes `limit` and
  `cursor`. The bound is one number for all of them: a caller cannot ask one
  route for a page the others refuse, and a list that names no `limit` reads a
  default page rather than the whole table.

  @integration @rest
  Scenario: Every paged list refuses a page past the cap
    Given the virtual-key, budget and cache-rule lists
    When each is asked for `?limit=201`
    Then each answers 422 with code "validation_error"
    And none reads a row

  @integration @rest
  Scenario: Every paged list refuses a page of no rows
    Given the virtual-key, budget and cache-rule lists
    When each is asked for `?limit=0`
    Then each answers 422 with code "validation_error"

  @integration @rest
  Scenario: A list that names no page size reads the default page
    Given the virtual-key, budget and cache-rule lists
    When each is asked with no `limit`
    Then each reads 50 rows
    And a `?limit=200` is read as 200 rows
