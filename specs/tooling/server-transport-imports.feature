Feature: Server imports keep API transports out of worker composition
  Analytics, Gateway, Scenario, and Trace are composed by both API and worker
  processes. Their server roots expose services and process composition.
  HTTP and RPC handlers have explicit package subpaths over the same files.

  @unit
  Scenario: Naming a feature server does not load its HTTP and RPC handlers
    Given an Analytics, Gateway, Scenario, or Trace server root import
    When its workspace dependencies are followed including type imports
    Then none of that feature's transport modules are loaded

  @integration
  Scenario: The API mounts the existing handlers through explicit subpaths
    Given an API process composing one of those features
    When it imports the REST or tRPC transport from its declared package subpath
    Then it mounts the existing handler implementation
    And URLs, procedure names, authorization, and response shapes are preserved
