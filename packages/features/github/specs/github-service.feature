Feature: GitHub service boundary

  Scenario: one process composes one GitHub capability
    Given the application supplies GitHub persistence and provider ports
    When the runtime creates the GitHub adapter
    Then every GitHub caller receives the same GithubService contract instance
    And no request constructs a repository or provider client

  @unit
  Scenario: private repository access stays behind the service
    Given a GitHub installation or pull-request row is read
    When the service handles the operation
    Then generated persistence values are mapped to portable contract values
    And repository implementations are not exported from the server root

  @unit
  Scenario: optional GitHub discovery is explicit
    Given an organization may not have an installation
    When a caller performs optional discovery
    Then the capability is named with a try prefix
    And a required lookup throws a concrete domain error

  @unit
  Scenario: installation tokens are ephemeral
    Given an organization has a GitHub App installation
    When Langy or pull-request linkage requests access
    Then the service mints a short-lived installation token
    And no token is written to GitHub persistence

  @unit
  Scenario: compatibility transports keep their public paths
    Given an existing GitHub REST or tRPC route is called
    When the feature is composed through the application
    Then the route delegates to GithubService
    And its path and response contract remain unchanged
