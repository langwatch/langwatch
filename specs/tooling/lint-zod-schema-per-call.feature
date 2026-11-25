@adr-139
Feature: Zod schemas are built once
  Zod compiles an object schema's parser on its first parse and caches it on
  that instance. A schema built inside a loop or a per-request method pays
  construction and compilation on every row or call: measured on 20,000 rows,
  0.6 ms hoisted against 487 ms built per row.

  Rule: `zod-schema-per-call` reports a Zod schema constructed inside an
    iteration or a class method, unless the method returns it unparsed

  @unit
  Scenario: A schema built inside an iteration is reported once
    Given a function builds a Zod schema inside a loop body or a map callback
    When lint runs
    Then zod-schema-per-call reports the outermost construction once
    And it directs the reader to a module-level constant

  @unit
  Scenario: A schema built inside a class method is reported
    Given a service or repository method builds a Zod schema and parses with it
    When lint runs
    Then zod-schema-per-call names the method the schema is rebuilt in

  @unit
  Scenario: A schema built once is left alone
    Given the schema is built at module scope, in a module-scope iteration, in a static field, or returned unparsed by a factory
    When lint runs
    Then zod-schema-per-call reports nothing

  @unit
  Scenario: Tests are excluded from the per-call check
    Given the construction sits in a test file
    When lint runs
    Then zod-schema-per-call reports nothing
