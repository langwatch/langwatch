# See dev/docs/ARCHITECTURE.md §8 and ruling R10 (Alex, 2026-10-06).
Feature: A REST path served outside its owner's namespace says so on the route
  For the migration only, a module may serve a path in another module's namespace, so a door can
  move owner with its path unchanged. It does so by explicit declaration on the route: the module
  whose namespace it is, why another module serves it, and the plan that retires it. The route
  registry carries every such route, so the record and an audit can list them.

  Rule: A shared path names its owner, its reason and its deprecation plan

    @unit
    Scenario: The registry lists a shared path with its owner, its server, its reason and its plan
      Given a literal family of one module with a route declaring a shared path owned by another module
      When the family is mounted
      Then the registered route names the owning module, the module serving it, the reason and the deprecation plan
      And a route declaring no shared path carries none

    @unit
    Scenario: A shared path that does not say why or when it goes is refused at declaration
      Given a route declaring a shared path
      When its reason or its deprecation plan is blank
      Then the declaration is refused, naming the path

    @unit
    Scenario: A module cannot declare a shared path with itself
      Given a route declaring a shared path whose owner is the module serving it
      When the family is mounted
      Then the mount is refused, naming the module and the path

    @unit
    Scenario: A shared path lives only in a family that claims no prefix
      Given a dated family whose route declares a shared path
      When the family is mounted
      Then the mount is refused, because the family's own middleware would run ahead of the owner's routes

  Rule: A namespace prefix is claimed by one module

    @integration
    Scenario: A second module claiming a prefix another module claims is refused at mount
      Given a host that mounted a family of one module claiming a namespace
      When a family of another module claiming the same namespace is mounted on it
      Then the mount is refused, naming both modules and the shared-path declaration to use instead

    @integration
    Scenario: One module may mount several families on its own prefix
      Given a host that mounted a family of one module claiming a namespace
      When another family of the same module claiming the same namespace is mounted on it
      Then both families answer
