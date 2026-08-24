Feature: Enterprise web composition

  Scenario: Compose portable license status
    Given a portable license status response
    When the Enterprise web composition is created with that status
    Then the composition exposes it without importing server cryptography

  Scenario: Import web composition safely
    When the web composition package is imported
    Then no provider, component, route, or global state is registered
