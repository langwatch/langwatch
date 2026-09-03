# See ../adrs/20260820-api-framework-boundary.md
# See ../adrs/002-explicit-version-namespaces.md
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
    When the route-coverage check runs
    Then it reports the route under the route-coverage rule
    And the check exits non-zero

  Scenario: An internal route is excluded by a written reason
    Given a handler registered under a public prefix
    And an exclusion entry naming that operation and why it stays unpublished
    When the route-coverage check runs
    Then the route is not reported

  Scenario: An exclusion that no longer suppresses anything fails the check
    Given an exclusion entry for an operation that no longer exists
    When the route-coverage check runs
    Then it reports the entry as stale
    And the check exits non-zero

  Scenario: A route annotated but whose app is unwired is still caught
    Given a handler carrying describeRoute metadata
    And its Hono app is not imported by the spec generator
    When the route-coverage check runs
    Then the route is reported as missing from the document

  # The check reads the route table out of the app's own source, so its blind
  # spots are its own. Two of them made whole families invisible: a file that
  # registers routes against a sibling's app declares no basePath, and a
  # parameter carrying a Hono regex constraint templated to a path shape that
  # matches nothing. Neither hid anything undocumented, but a gate that cannot
  # see a route cannot notice one going missing, which is the whole claim.

  Scenario: Routes registered in a file with no basePath are still counted
    Given a file that registers routes against an app its sibling constructed
    And the file declares no basePath of its own
    When the route table is read
    Then its routes are counted under the sibling's basePath

  Scenario: A parameter's routing constraint does not reach the template
    Given a route whose parameter carries a Hono regex constraint
    When the route table is read
    Then the constraint is dropped and the parameter templates on its own

  # Newer families do not construct their own Hono app: they declare a service,
  # and one declaration fans out into several mounts: a dated version, a
  # `latest` alias, the bare path every reader gets pointed at, and a 410 for
  # anything withdrawn. Each of those shapes is a way for a family to fall out
  # of the route table, and a family the gate cannot see is a family whose next
  # missing route nobody notices. The same applies to the generator's own side:
  # an app it merges whose prefix nobody declared public is checked by nothing.

  Scenario: A service declaring only its name is counted under its derived prefix
    Given a family declared as a service with a name and no explicit base path
    When the route table is read
    Then its routes are counted under the prefix derived from that name

  # Amended with ADR 002: the dated mounts ARE the counted routes. One
  # registration fans out into every dated namespace it serves plus `latest`,
  # and the bare alias it would once have collapsed onto no longer exists.
  Scenario: A versioned registration is counted at its dated and latest mounts
    Given an endpoint served at two dated versions and at latest
    When the route table is read
    Then the endpoint is counted at each dated mount and at the latest mount
    And no bare path is reported for it

  Scenario: An SSE endpoint is counted as a GET route
    Given an endpoint that streams server-sent events
    When the route table is read
    Then it is counted as a GET route
    And it must be documented or excluded like any other route

  Scenario: A test helper named createService declares no service
    Given a test file with a local helper of its own named createService
    And the file does not declare a service
    When the route table is read
    Then no base path is derived from that helper

  Scenario: A withdrawn endpoint is accounted for without an exclusion entry
    Given an endpoint withdrawn from a family, answering callers still on it
    When the route-coverage check runs
    Then the endpoint is reported as withdrawn
    And it needs no exclusion entry, because a withdrawn route cannot be published

  Scenario: Every app the generator merges is covered by an app-derived prefix
    Given the set of apps the spec generator merges into the document
    When the public prefixes are checked
    Then every one of those apps sits under a declared prefix
    And an app whose prefix is missing fails the check
