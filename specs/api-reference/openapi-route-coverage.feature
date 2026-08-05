@unit
Feature: Every public REST route reaches the OpenAPI document
  As an integrator reading the LangWatch API reference
  I want every endpoint the SDKs call to appear in the published spec
  So that I can build against the REST API without reading SDK source

  # A route is published in three steps, and skipping any one of them leaves
  # the endpoint working but invisible:
  #
  #   1. the handler carries `describeRoute({...})`      — hono-openapi skips
  #      unannotated routes entirely, so an un-annotated handler contributes
  #      nothing to the document no matter what else is wired
  #   2. its Hono app is imported by `generateOpenAPISpec`  — an app nobody
  #      imports is never asked for its spec
  #   3. a group in `generate-api-reference-pages` owns its path — otherwise
  #      the operation sits in the JSON with no page a reader can find
  #
  # Experiments failed all three at once: a customer evaluating LangWatch read
  # the API reference, found no way to create an experiment, and concluded the
  # REST API could not do it. It could; `POST /api/experiment/init` has existed
  # and been the SDK's own call the whole time.
  #
  # The gate below closes step 1 and 2 for good. Public prefixes are checked
  # exhaustively, and every route that is deliberately absent carries a written
  # reason. The list is ratcheted: an entry that stops suppressing anything is
  # itself a failure, so it cannot outlive the reason it was written for.

  Background:
    Given the route table registered by the API router
    And the generated document at src/app/api/openapiLangWatch.json

  Scenario: A public route missing from the document fails the check
    Given a handler registered under a public prefix
    And no operation for it in the generated document
    When the completeness check runs
    Then it reports the route under the route-coverage rule
    And the check exits non-zero

  Scenario: An internal route is excluded by a written reason
    Given a handler registered under a public prefix
    And an exclusion entry naming that operation and why it stays unpublished
    When the completeness check runs
    Then the route is not reported

  Scenario: An exclusion that no longer suppresses anything fails the check
    Given an exclusion entry for an operation that no longer exists
    When the completeness check runs
    Then it reports the entry as stale
    And the check exits non-zero

  Scenario: A route annotated but whose app is unwired is still caught
    Given a handler carrying describeRoute metadata
    And its Hono app is not imported by the spec generator
    When the completeness check runs
    Then the route is reported as missing from the document
