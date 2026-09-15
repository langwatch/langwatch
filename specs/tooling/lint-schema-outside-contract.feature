# See ../../dev/docs/adr/137-module-source-grammar.md
# A transport file declares routes and imports its shapes; the wire's
# vocabulary lives in the module's contract package so the browser, the SDK
# and another module can all read it without importing a server package.

Feature: The linter keeps Zod schemas out of the transport layer

  As a module author
  I want the linter to refuse a Zod schema authored inside a transport file
  So that the request and response shapes live in the contract, where every
  side of the wire can import them

  Background:
    Given the langwatch oxlint plugin runs over the workspace sources

  Rule: A schema authored in a transport file is reported

    @unit
    Scenario: A Zod schema authored in a transport file is reported
      Given a transport file with a top-level const named with a Schema suffix
        built from z.object
      When the rule runs
      Then it names the schema and says to move it to the contract package

    @unit
    Scenario: An exported top-level Zod object without a Schema suffix is reported
      Given a transport file that exports a top-level const built from z.object
      When the rule runs
      Then it is reported too

    @unit
    Scenario: Composing a schema authored in the same transport file is reported
      Given a transport file where one top-level const extends another
        top-level const that is itself authored from z.object
      When the rule runs
      Then both the base schema and the schema derived from it are reported

  Rule: Composing an imported contract schema is not authoring one

    @unit
    Scenario: Composing an imported contract schema is not this rule's business
      Given a transport file where a top-level const extends a schema
        imported from the module's contract package
      When the rule runs
      Then it reports nothing

    @unit
    Scenario: A non-exported non-Schema-named constant is not this rule's business
      Given a transport file with a non-exported top-level const whose name
        does not end in Schema
      When the rule runs
      Then it reports nothing

    @unit
    Scenario: A Zod schema outside transport is not this rule's business
      Given a server file outside the transport directory with a top-level
        Schema constant
      When the rule runs
      Then it reports nothing
