Feature: A query error tells the caller how to fix it

  As a coding agent (or any API client) calling the LangWatchQL query door
  I want a refusal to name exactly what I got wrong and what is actually available
  So that I can recover without guessing or re-reading the docs

  Issue: #8085.

  Rule: Use a function that is not supported

    @e2e @unimplemented
    Scenario: Use a function that is not supported
      Given a user with an API key with access to at least one project
      When they run a query using a function that is not supported
      Then they are told which functions are supported

    @unit
    Scenario: A FUNCTION_NOT_ALLOWED violation carries the complete allowlist
      Given the LangWatchQL function allowlist the validator enforces
      When a query calling a disallowed function is refused
      Then the violation's allowedFunctions is the complete, sorted, deduplicated allowlist
      And allowedFunctions equals the validator's own enforced set
      And the violation's message names GET /api/v1/query/schema as where the list lives

    @integration
    Scenario: The REST caller receives allowedFunctions on a function violation
      Given an authenticated API client
      When it submits a query calling a disallowed function
      Then the response's meta.violations entry for the refusal includes allowedFunctions

    @unit
    Scenario: The docs list every allowed function name, kept equal to the validator's allowlist
      Given docs/api-reference/query/overview.mdx
      Then it has a Supported functions section stating the list is served by GET /api/v1/query/schema
      And it lists every function name the validator allows
      And a diff test asserts the documented names equal the validator's allowlist

  Rule: Use a column or dataset that does not exist

    @e2e @unimplemented
    Scenario: Use a column or dataset that does not exist
      Given a user with an API key with access to at least one project
      When they run a query naming a column or dataset that does not exist
      Then they are told what exists
