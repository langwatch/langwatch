Feature: A module declares its channels and the container builds them

  A module names its channel registry on its installer with `.withChannels(...)`,
  declared with `defineChannels({ live, memory })`. The container builds the tier
  the stores state, once per install, and hands it to the module class as
  `setup.channels`: record §3.2 and §5. Calling a registry's `.live.create` by
  hand is a deleted spelling (record §15).

  @unit
  Scenario: The container builds a module's channels on the tier its stores state
    Given a module that declares live and memory channels with .withChannels
    When a harness boots it over memory stores
    Then the module class is handed the memory channels and the live tier is never built
    And where a process states the live tier, the live tier is built once over the store it requires and the module's parsed config
    And a module that also declares repositories gets its channels on the same tier as its repositories

  @unit
  Scenario: A channel tier that needs a store the process did not open refuses boot by name
    Given a module whose live channel tier requires a store
    When a process states the live tier but did not open that store
    Then boot refuses, naming the module and the store
    And no channel of either tier is built

  @unit
  Scenario: A channel tier that reaches for an undeclared store does not compile
    Given a channel tier whose create reads a store its requires does not name
    When the registry is declared with defineChannels
    Then it is a compile error rather than an undefined at runtime

  @unit
  Scenario: A channel bound to another module's *Api is filled once both modules resolve
    Given a module whose channel tier binds another module's *Api token with static binds
    And that module does not list the token in its static dependencies
    And the token's owner depends on the module in turn
    When the process boots with both installed
    Then boot orders nothing by the binding and refuses no cycle
    And after boot a call through the channel reaches the owner's implementation
    And a call made while the process is still constructing refuses by name

  @unit
  Scenario: A channel bound to an *Api nobody installed refuses boot by name
    Given a module whose channel tier binds another module's *Api token
    When a process installs the module without the token's owner
    Then boot refuses, naming the module, the binding and the token
