Feature: What a process refuses and what it skips at boot

  A process boots only on a store tier somebody stated, and installs a module
  whatever surfaces it selected: record §7 (store tiers) and §4 (surfaces).

  @unit
  Scenario: A module with repositories refuses to boot where no store tier was stated
    Given a module that declares live and memory repositories
    And a process whose stores state no tier and whose caller asked for none
    When the process boots
    Then it refuses by name, naming the module and that no store tier was stated
    And no repository of either tier is built

  @unit
  Scenario: A harness reaches memory only by handing memory stores
    Given a module that declares live and memory repositories
    When a test or dev harness boots it over memory stores and states nothing else
    Then the module runs on its memory repositories

  @unit
  Scenario: A module installs without the transport whose surface the process did not select
    Given an api process that selects the REST surface and not tRPC
    And a module that declares a REST family and a tRPC namespace
    When the process boots
    Then the module installs and its REST family is mounted
    And its tRPC namespace is skipped rather than refused
