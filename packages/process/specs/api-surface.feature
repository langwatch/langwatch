Feature: The API surface's own answers
  The API process mounts every transport, then answers what nothing serves.

  @unit
  Scenario: An address under the API that nothing serves answers main's not-found body
    Given the API surface with no route at an address
    When a caller requests that address
    Then the answer is 404 with the body {"error":"Not Found"}
