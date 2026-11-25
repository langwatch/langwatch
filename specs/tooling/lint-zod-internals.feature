Feature: The zod-internals lint rule

  Reaching past Zod's public API into its internals has shipped two real bugs,
  both documented in dev/docs/best_practices/zod.md: a `.innerType()` call that
  exists under one installed Zod major and not the other, and a `ZodError`
  minted by one major that fails `instanceof` against the other's class. The
  repository runs both majors at once, which is exactly why `_def` and
  `instanceof ZodX` answer differently depending on which copy produced the
  value. `._def` is reported off anything recognisably a Zod schema: a `z.`
  chain, a schema-named binding, a Zod-annotated one, or a local aliasing any
  of those — the file that motivated this rule named its schema `s`. A tRPC
  router or procedure also carries a `_def`, and reading it is not reaching
  into Zod, so a receiver that is not a Zod schema is left alone.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: reading a schema's def is reported
    Given a governed source file that reads ._def off a schema-named identifier or a z. call chain
    When the zod-internals rule runs over it
    Then it reports defAccess
    And the message names the schema expression and tells the reader to export the un-refined schema instead

  @unit
  Scenario: an aliased schema's def is reported too
    Given a governed source file that reads ._def off a local not named like a schema, aliasing a schema or annotated with a Zod type
    When the zod-internals rule runs over it
    Then it reports defAccess
    And the message names the local it was read off

  @unit
  Scenario: an instanceof ZodError check is reported
    Given a governed source file that tests an error with instanceof ZodError or instanceof z.ZodError
    When the zod-internals rule runs over it
    Then it reports zodErrorInstanceOf
    And the message tells the reader to check Array.isArray(error.issues) instead

  @unit
  Scenario: a def read off something that is not a Zod schema is left alone
    Given a governed source file that reads ._def off a tRPC router or a value narrowed from unknown
    When the zod-internals rule runs over it
    Then it reports nothing
