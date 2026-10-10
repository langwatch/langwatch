Feature: The contract-schema-named lint rule
  An exported composite Zod schema in a contract is declared as a private
  definition, an interface naming its type and the export typed by it, so
  emitted declarations print the name instead of the whole Zod tree at every
  use (ADR-178). The rule carries the fix. Primitive schemas, recursive ones
  and already-annotated constants are left alone, and only contract source is
  governed.

  @unit
  Scenario: An exported object schema without a name is a failure
    Given a contract file exporting `agentSchema = z.object(...)`
    When the contract-schema-named rule runs over it
    Then it reports unnamedSchema naming agentSchema

  @unit
  Scenario: The fix names the schema and imports Named
    Given a contract file exporting an unnamed object schema
    When the rule's fix is applied
    Then the schema becomes a definition, an `AgentSchema` interface and a typed export
    And `Named` is imported from @langwatch/module

  @unit
  Scenario: Named, primitive and recursive schemas pass
    Given a contract file with an annotated schema, a string schema, an enum and a recursive schema
    When the contract-schema-named rule runs over it
    Then it reports nothing

  @unit
  Scenario: Schemas outside a contract pass
    Given a process file exporting an unnamed object schema
    When the contract-schema-named rule runs over it
    Then it reports nothing
