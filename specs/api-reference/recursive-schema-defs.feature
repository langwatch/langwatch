@unit
Feature: A recursive response schema publishes a document that resolves
  As an integrator generating a client from the API document
  I want a schema like "any JSON value" to publish a self-contained definition
  So that a generated client does not choke on a $ref pointing at nothing

  # zod v4's OpenAPI adapter (toOpenAPISchema, behind hono-openapi's resolver())
  # rewrites a recursive type's self-reference to `#/components/schemas/<name>`
  # but leaves the actual definition sitting in that response's own local
  # `$defs`, never hoisted into the document's top-level `components.schemas`.
  # Two different routes can each produce a `$defs` entry named the same
  # generic `__schema0` — z.record(z.string(), z.json()) is one real shape
  # that triggers it — so hoisting has to rename per occurrence, never assume
  # the anonymous name is unique across the whole document.

  Scenario: A schema with a local $defs block is hoisted into components
    Given a response schema carrying a local "$defs" entry
    When the document is written
    Then that entry moves into the document's "components.schemas"
    And the schema's own "$defs" is gone
    And every $ref that pointed at the local entry now points at its new place

  Scenario: Two unrelated schemas each name a $defs entry the same generic name
    Given two response schemas that each carry a "$defs" entry named "__schema0"
    When the document is written
    Then each is hoisted under its own distinct name in "components.schemas"
    And neither overwrites the other

  Scenario: A $defs entry that references itself keeps resolving after the move
    Given a response schema whose "$defs" entry contains a $ref to itself
    When the document is written
    Then the hoisted definition's self-reference points at its own new name

  Scenario: A schema with no $defs is left exactly as it was
    Given a response schema with no "$defs" entry
    When the document is written
    Then the schema is unchanged
