Feature: Gateway list pages for a viewer without the grant
  As a member who can open the Gateway section,
  I want a list I am not allowed to read to say so,
  so that I know to ask for access instead of retrying a load that cannot succeed.

  # Budgets and cache rules are read at the organization. A member who holds
  # the view grant only on a team or project can open the page and is refused
  # the list.
  #
  # Bindings: modules/gateway/browser/src/ui/elements/__tests__/gateway-error-panel.integration.test.tsx

  @integration
  Scenario: A refused gateway list reads as no access, not as a failed load
    Given a gateway list the server refused for a missing grant
    When the page renders the failed query
    Then it says the viewer does not have permission and names the grant
    And it offers no retry
    And it does not repeat the server's own sentence

  @integration
  Scenario: A gateway list that failed to load keeps its retry
    Given a gateway list that failed for any other reason
    When the page renders the failed query
    Then it shows the load error with a retry
