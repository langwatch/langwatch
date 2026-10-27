Feature: A module's api provider is mounted by the shell
  A module that calls createModuleApi owns its own tRPC react instance. Its
  Provider has to be mounted above the screens that use it, or the first hook
  throws "Unable to find tRPC Context" at render — on whichever screen the
  customer happened to open.

  The declaration is how the shell learns of it: a module declares its api, and
  the composition root collects every declared one and mounts them together.

  Background:
    Given a browser application composed from the installed module list

  @unit
  Scenario: A module api client reports as a function, not an object
    Given a client built by createModuleApi
    When the shell inspects it to decide whether it can be mounted
    Then the client reports its type as a function
    And asking whether it has a Provider by key says no
    And it owns no enumerable keys
    But its Provider is a real component
    # The shape is surprising, and a predicate written from the obvious
    # assumption rejects every valid client. Pinned so a tidy-up cannot
    # quietly reintroduce the assumption.

  @unit
  Scenario: Every module that declares an api has its provider mounted
    Given two installed modules that each declare an api
    When the composition root collects the installed apis
    Then both providers are returned, each named by its module

  @unit
  Scenario: A module whose declared api has nothing to mount is refused by name
    Given an installed module that declares an api carrying no Provider
    When the composition root collects the installed apis
    Then it refuses, naming the module
    # Refused where the application is composed, not where a screen renders:
    # the same rule the record gives for an unmounted host.

  @unit
  Scenario: A module that declares no api is passed over
    Given an installed module that declares no api
    When the composition root collects the installed apis
    Then nothing is returned for it, and no refusal is raised
