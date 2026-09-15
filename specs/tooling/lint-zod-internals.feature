Feature: The zod-internals lint rule

  Reaching past Zod's public API into its internals has shipped two real bugs,
  both documented in dev/docs/best_practices/zod.md: a `.innerType()` call that
  exists under one installed Zod major and not the other, and a `ZodError`
  minted by one major that fails `instanceof` against the other's class. The
  repository runs both majors at once, which is exactly why `_def` and
  `instanceof ZodX` answer differently depending on which copy produced the
  value. `._def` is reported on any object, aliased or not — a
  naming-convention gate would have missed the very file that motivated this
  rule, whose schema variable is named `s`, not `mySchema`. The one exclusion
  is the tRPC host file: its router type has no public accessor for a
  procedure's kind, so `._def` is the entire API surface for that lookup, not
  a shortcut around one.

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
    Given a governed source file that reads ._def off a local not named like a schema
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
  Scenario: the tRPC host's def reads are left alone
    Given the tRPC host file reading its router's def to classify a procedure's kind
    When the zod-internals rule runs over it
    Then it reports nothing
