Feature: The schema-outside-contract lint rule
  A transport file declares routes and imports its shapes from the module's
  contract. A Zod schema authored in a transport file is a shape only the
  process can see, so every other side of the wire ends up with a copy that
  drifts. Every zod entrypoint counts as authoring: zod, zod/v4, zod/mini.

  @unit
  Scenario: A Zod schema authored in a transport file is reported
    Given a transport file that declares a Schema-named constant built from z
    When the schema-outside-contract rule runs over it
    Then it reports schema and names the module's contract source folder

  @unit
  Scenario: A Zod schema authored through zod/v4 or zod/mini is reported
    Given a transport file that builds a schema from z imported through zod/v4 or zod/mini
    When the schema-outside-contract rule runs over it
    Then it reports schema on the declaring line

  @unit
  Scenario: An exported top-level Zod object without a Schema suffix is reported
    Given a transport file that exports a z.object() constant without a Schema suffix
    When the schema-outside-contract rule runs over it
    Then it reports schema

  @unit
  Scenario: Composing an imported contract schema is not this rule's business
    Given a transport file that extends a schema imported from the contract
    When the schema-outside-contract rule runs over it
    Then it reports nothing

  @unit
  Scenario: Composing a schema authored in the same transport file is reported
    Given a transport file that extends a schema it authored itself
    When the schema-outside-contract rule runs over it
    Then it reports schema

  @unit
  Scenario: A non-exported non-Schema-named constant is not this rule's business
    Given a transport file with a private z.object() constant without a Schema suffix
    When the schema-outside-contract rule runs over it
    Then it reports nothing

  @unit
  Scenario: A Zod schema outside transport is not this rule's business
    Given a process service file that declares a Schema-named constant
    When the schema-outside-contract rule runs over it
    Then it reports nothing
