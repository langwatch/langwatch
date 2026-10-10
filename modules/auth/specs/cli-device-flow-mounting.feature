Feature: The api serves the CLI device flow main serves
  `langwatch login` gets its token through the RFC 8628 device grant under
  `/api/auth/cli`. Without these routes a CLI can never sign in, so the
  governance CLI plane behind that token is unreachable.

  @integration
  Scenario: The api answers the CLI device flow routes main serves
    Given the api process installed over memory stores
    When a CLI starts a device login on "/api/auth/cli/device-code"
    Then it is answered 200 with a verification address on the deployment's origin
    And exchange, refresh, lookup, approve, deny and logout each answer main's status rather than 404
