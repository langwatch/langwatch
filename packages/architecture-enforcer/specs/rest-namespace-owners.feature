# See dev/docs/ARCHITECTURE.md §3 and §8; ruling "REST namespace ownership" (Alex, 2026-10-05, night).
Feature: Every REST namespace has one owner, and a path served outside it says so
  modules/catalogue.json names the module that owns each REST namespace, the first segment after
  /api/ (or /api/v1/). The category prefixes otel, internal, export, webhooks, connect, auth and
  scenario stay unowned: several modules serve under them. A module serving a path in a namespace
  another module owns declares it on the route with .withSharedPath, naming that owner. The
  project analytics paths are a permanent shared path; every other one is planned for deprecation.

  Rule: The catalogue names the owner of each REST namespace

    @unit
    Scenario: A feature lists the REST namespaces it owns
      Given a catalogue entry listing its REST namespaces, sorted and free of duplicates
      When the catalogue is read
      Then each namespace is owned by that feature

    @unit
    Scenario: Two features cannot own the same REST namespace
      Given two catalogue entries listing the same REST namespace
      When the catalogue is read
      Then the catalogue is refused, naming the namespace and both features

    @unit
    Scenario: A malformed REST namespace list is refused
      Given a catalogue entry whose REST namespaces are unsorted, duplicated or not lower-case path segments
      When the catalogue is read
      Then the entry is refused as malformed

    @unit
    Scenario: The category prefixes are owned by no feature
      Given the repository's catalogue
      When its REST namespace owners are read
      Then none of otel, internal, export, webhooks, connect, auth and scenario has an owner

  Rule: A literal route under another module's claimed prefix is refused at mount unless declared

    @unit
    Scenario: A literal route under another module's claimed prefix is refused at mount
      Given a host that mounted a family of one module claiming a prefix
      When a literal family of another module serving a route under that prefix is mounted, in either order
      Then the mount is refused, naming both modules, the path and the shared-path declaration to write

    @unit
    Scenario: A literal route declaring a shared path with the claiming module is admitted
      Given a host that mounted a family of one module claiming a prefix
      When a literal family of another module declares a shared path owned by that module for its route under the prefix
      Then both families answer

    @unit
    Scenario: A shared path naming a module other than the claimant is refused at mount
      Given a host that mounted a family of one module claiming a prefix
      When a literal route of another module under that prefix declares a shared path owned by a third module
      Then the mount is refused, naming the module that claims the prefix

  Rule: A shared path is planned for deprecation unless it is declared permanent

    @unit
    Scenario: A permanent shared path carries no deprecation plan
      Given a route declaring a permanent shared path
      When the family is mounted
      Then the registered route names its owner and reason and says it is permanent

  Rule: The rest-namespace-owners policy holds every route to the owner map

    @unit
    Scenario: A route under another module's owned namespace without a shared path is a finding
      Given a namespace the catalogue gives to one module
      When another module's REST transport serves a route under it with no shared path
      Then the policy reports the route and tells the author which shared-path declaration to write

    @unit
    Scenario: A route declaring a shared path with the namespace owner passes
      Given a namespace the catalogue gives to one module
      When another module's route under it declares a shared path owned by that module
      Then the policy reports nothing

    @unit
    Scenario: A shared path naming the wrong owner is a finding
      Given a route declaring a shared path
      When the namespace it sits in is owned by another module, or by none
      Then the policy reports the route, naming the owner it should name or telling the author to drop the declaration

    @unit
    Scenario: A route under an unowned category prefix passes
      Given a namespace no feature owns
      When two modules serve routes under it
      Then the policy reports nothing

    @unit
    Scenario: The repository's REST routes are held to the owner map
      Given the repository's catalogue and REST transports
      When the policy runs
      Then it reports nothing, and the four overlaps are declared as shared paths with their owners
