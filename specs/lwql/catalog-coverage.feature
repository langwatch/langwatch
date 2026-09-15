Feature: I can query all of my data through LangWatchQL

  As a user calling the LangWatchQL query door
  I want every table LangWatch stores on my behalf to already be a queryable view
  So that I never hit a wall asking about data I know LangWatch has

  Issue: #8085

  @unit @unimplemented
  # Proof: catalog/__tests__/tenantTableCoverage.unit.test.ts
  Scenario: A caller can query every table LangWatch holds for their projects
    Given the tables LangWatch stores for a caller's projects
    When the caller asks LangWatchQL what they can query
    Then every one of those tables is available as a view
    And the only tables not offered are bookkeeping ones that hold no customer data, each with a recorded reason
