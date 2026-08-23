# See ../adrs/001-rpc-first-fluent-registration.md
# See api-discovery.feature
Feature: RPC endpoints

  As a feature author
  I want RPC endpoints identified by a dotted name and called by POSTing a
  JSON body
  So that the grammar is machine-checked, identifiers are validated, and the
  discovery catalogue cannot drift from the served surface

  @typecheck
  Scenario Outline: The name grammar is enforced in the editor
    When the author registers the name "<name>"
    Then the type system <verdict>

    Examples:
      | name              | verdict  |
      | things.create     | accepts  |
      | endpoints.rollSecret | accepts |
      | /things.create    | rejects: a name is an identifier, not a path |
      | things            | rejects: at least one dot |
      | things/:id        | rejects: no parameters |
      | things.RollSecret | rejects: verb segments start lowercase |

  @unit
  Scenario: The same grammar is enforced again at startup
    Given a registration built by a JavaScript caller or an any-widened config
    When the name violates the grammar
    Then the build throws naming the rule
    And the type-level and startup statements are driven by one test table

  @unit
  Scenario: Every argument travels in the JSON body
    When an RPC endpoint declares params or query in its chain
    Then registration fails, because RPC arguments belong in input

  @unit
  Scenario: Every RPC is a POST, reads included
    Given an RPC endpoint whose handler only reads
    When the route table is read
    Then the endpoint is mounted as POST and no other method

  @unit
  Scenario: A no-argument RPC accepts a bodyless call
    Given an RPC endpoint declaring no input
    When a caller POSTs with no body
    Then the handler runs
    And a caller POSTing an empty object gets the same result

  @integration
  Scenario: RPC paths survive spec generation only when static files are not excluded
    Given a service with RPC endpoints
    When the document is generated with excludeStaticFile left at its default
    Then every dotted path is silently dropped as a static file
    And a host generating specs must pass excludeStaticFile: false

  @unit
  Scenario: The discovery catalogue asks the same grammar
    Given the platform's RPC catalogue projecting the published document
    When it decides whether a dotted path is an RPC
    Then it asks isRpcPath from the package rather than a regex of its own
