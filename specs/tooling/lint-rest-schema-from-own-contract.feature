Feature: The rest-schema-from-own-contract lint rule
  A `.rest.ts` or `.trpc.ts` file under a module's `server` package declares
  routes only. Every shape it needs already exists in its OWN module's
  contract package: never authored inline, and never borrowed from another
  module's contract - a cross-module need means the shape belongs in this
  module's own contract, or the route belongs in the other module.

  Background:
    Given a workspace whose agent and experiment features are at strict
      layout version 0

  @unit
  Scenario: An inline z.object() in a REST transport file is reported
    Given a REST transport file that builds a schema with z.object() inline
    When the rest-schema-from-own-contract rule runs over it
    Then it reports inlineSchema
    And the message names the factory and the file

  @unit
  Scenario: An inline z.enum() in a REST transport file is reported
    Given a REST transport file that builds a schema with z.enum() inline
    When the rest-schema-from-own-contract rule runs over it
    Then it reports inlineSchema

  @unit
  Scenario: A same-named factory not imported from zod is not this rule's business
    Given a transport file whose `z` identifier comes from a local module, not zod
    When the rest-schema-from-own-contract rule runs over it
    Then it reports nothing

  @unit
  Scenario: A schema built at runtime inside a handler body is not this rule's business
    Given a transport file that builds a schema inside a route handler's own body
    When the rest-schema-from-own-contract rule runs over it
    Then it reports nothing

  @unit
  Scenario: Importing a schema from the module's own contract is not this rule's business
    Given a transport file that imports a schema from its own module's contract package
    When the rest-schema-from-own-contract rule runs over it
    Then it reports nothing

  @unit
  Scenario: Importing a schema from another module's contract is reported
    Given a transport file that imports a schema from another module's contract package
    When the rest-schema-from-own-contract rule runs over it
    Then it reports foreignContract
    And the message names the foreign contract source and the importing module

  @unit
  Scenario: Importing a subpath of another module's contract is reported
    Given a transport file that imports a subpath export of another module's contract package
    When the rest-schema-from-own-contract rule runs over it
    Then it reports foreignContract

  @unit
  Scenario: Importing an unrelated non-contract package is not this rule's business
    Given a transport file that only imports zod itself
    When the rest-schema-from-own-contract rule runs over it
    Then it reports nothing

  @unit
  Scenario: A non-transport server file is not this rule's business
    Given a service file that is neither a .rest.ts nor a .trpc.ts file
    When the rest-schema-from-own-contract rule runs over it
    Then it reports nothing
