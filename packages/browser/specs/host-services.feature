Feature: Host services resolved from their one provider

  browser-host declares a host service; the module that owns it declares
  `.provides(Service, { load })`. createUi resolves each service to its one installed
  provider and refuses none or two, so the composing application names no provider.

  @unit
  Scenario: Each host service resolves to its one installed provider
    Given two host services, each provided by one installed module
    When the runtime resolves them
    Then each resolves to its provider, in the runtime's order

  @unit
  Scenario: A host service with no provider is refused at install
    Given a host service the runtime runs that no installed module provides
    When the runtime resolves it
    Then it is refused, naming the service

  @unit
  Scenario: A host service with two providers is refused at install
    Given two installed modules that provide one host service
    When the runtime resolves it
    Then it is refused, naming the service and both providers

  @unit
  Scenario: The composition refuses two providers before it renders
    Given a composition installing two providers of one host service
    When it renders
    Then the render is refused before anything mounts

  @unit
  Scenario: Each provided source runs with the shared input, in the runtime's order
    Given two host services whose sources are loaded
    When the runtime runs them for one render
    Then each source is called with the one transport, feedback, session and scope, in the runtime's order
    And each service's value is kept under its name

  @integration
  Scenario: A host service's hook reads the value its source produced this render
    Given the runtime published a host service's value
    When a screen reads that service through its hook
    Then it gets the value its source produced
