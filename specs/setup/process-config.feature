Feature: One generated Zod parse per process
  As an engineer composing a LangWatch process
  I want the process's whole configuration to come from one schema, generated
  from the app's own process values plus every installed module's declared
  config schema
  So that installing a module brings its configuration demand, no value is
  declared twice, and a missing or misplaced value refuses by name at boot
  rather than surfacing as `undefined` deep in a service

  # The ruled requirements are dev/docs/ARCHITECTURE.md section 6:
  # "One generated Zod parse per process" and "Config and secrets are separate".
  # The map of module name to schema is generated from the installed modules;
  # this feature covers the seam that consumes it, `defineProcessConfig`.

  @unit
  Scenario: The process and every installed module become one parsed object
    Given a process schema and two installed modules that each declare a config schema
    When the process configuration is parsed from the environment
    Then the result has one root key for the process and one per declaring module
    And each root key holds that schema's own values and nothing else

  @unit
  Scenario: A module that declares no config schema contributes nothing
    Given an installed module that declares no config schema
    When the process configuration is parsed from the environment
    Then the result carries no root key for that module

  @unit
  Scenario: The parsed configuration cannot be mutated
    Given a parsed process configuration
    When a caller assigns to one of its root keys
    Then the assignment does not change what the process holds

  @unit
  Scenario: A missing required value refuses naming its root, its field and its variable
    Given an installed module whose schema requires a value the environment does not set
    When the process configuration is parsed
    Then the refusal names the module root, the field and the environment variable

  @unit
  Scenario: A module config schema may not declare a credential
    Given an installed module whose schema binds a variable classified as a secret
    When the process configuration is declared
    Then it refuses naming the module, the field and the variable
    And it says a secret is injected into its consumer rather than carried on the config object

  @unit
  Scenario: A module config schema may not declare a connection string
    Given an installed module whose schema binds a variable classified as composite
    When the process configuration is declared
    Then it refuses naming the module, the field and the variable

  @unit
  Scenario: The process root may read a classified variable through the secrets chain
    Given a process schema that binds a variable classified as a secret
    When the process configuration is declared
    Then it is accepted, because the boot seam resolves that variable through the secrets chain

  @unit
  Scenario: One shared deployment fact may be claimed by several modules
    Given two installed modules whose schemas share one canonical deployment leaf
    When the process configuration is declared
    Then both modules read the same value from the one variable

  @unit
  Scenario: Two meanings for one variable still refuse
    Given two installed modules that bind the same variable to different values
    When the process configuration is declared
    Then it refuses naming the variable and both claimants

  @unit
  Scenario: A module may not take the process's own root key
    Given an installed module named after the process root
    When the process configuration is declared
    Then it refuses rather than letting the module overwrite the process values
