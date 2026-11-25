Feature: A virtual key's spend is read in one statement across the organization

  A key's traces land in whichever project resolved as its trace destination,
  so its spend is read across every project of the organization. That read is
  one statement over the organization's tenant set, as on main: one statement
  per project fills the ClickHouse statement queue in an organization with
  many projects, and the spend route then refuses instead of answering.

  @integration @rest @spend
  Scenario: A key's spend is read in one statement however many projects the organization has
    Given an organization with 400 projects
    And a virtual key whose traces landed in two of them, costing 0.75 and 0.50
    When I read the key's spend over REST by its id
    Then the response status is 200
    And spent_usd is "1.25" and requests is 2
    And trace was asked once, over all 400 projects

  @unit @spend
  Scenario: Spend of the organization's other keys is not counted against the key
    Given two keys with traces in the same project
    When the spend of one key is read
    Then only that key's traces are summed

  @unit @spend
  Scenario: An organization with no projects reads no spend without asking trace
    Given an organization with no projects
    When a key's spend is read
    Then the key has no spend
    And trace is not asked
