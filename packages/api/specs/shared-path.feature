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
    Scenario: A shared path lives only in a literal or a dated family
      Given a family addressed "v1-only" whose route declares a shared path
      When the family is mounted
      Then the mount is refused, naming the addressings that may share a path

  Rule: A dated family shares another module's namespace when every route says so

    A dated family whose every route declares a shared path with one owner claims no prefix: its
    own middleware runs on its own addresses only, so it never runs ahead of the owner's routes.

    @integration
    Scenario: Two modules serve one dated namespace, each at every address of its own routes
      Given a host that mounted a dated family of one module claiming a namespace
      And a dated family of another module on the same namespace whose every route declares a shared path with the first module
      When both families are mounted, in either order
      Then each route answers from its own handler at its bare, dated, latest and v1 addresses
      And a date after a family's version answers from that family's route
      And the registry lists the shared route with its owner and the module serving it
      And the published document lists each route once, at an undated address

    @integration
    Scenario: A dated family sharing a namespace with the wrong owner is refused at mount
      Given a host that mounted a dated family of one module claiming a namespace
      When a dated family of another module on that namespace declares its shared path with a third module
      Then the mount is refused, naming the module that claims the namespace

    @unit
    Scenario: The dated middleware scopes of a shared family are not undeclared endpoints
      Given a dated family sharing a namespace, whose middleware is mounted at the dated address of each route
      When the mounted routes are cross-checked against the registry
      Then a dated any-method mount over a registered path is not reported
      And a dated any-method mount over a path no route registers is still reported

    @unit
    Scenario: A dated family that both owns and shares its namespace is refused at mount
      Given a dated family where one route declares a shared path and another does not, or two routes name different owners
      When the family is mounted
      Then the mount is refused, naming the family and asking for the shared routes in a family of their own

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
