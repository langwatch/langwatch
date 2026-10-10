# 2026-09-08: the builder these scenarios were bound through is deleted (dev/docs/plans/api-legacy-delete.md).
# The behaviour is still the requirement. Each scenario is @unimplemented until the new runtime
# (defineRestRouter + createRestRuntime) earns it again with a bound test; then retag and remove
# the file from LEGACY_INERT in packages/architecture-enforcer/src/check-feature-parity.ts.
# See ../adrs/002-explicit-version-namespaces.md
Feature: Explicit compatibility version namespaces

  As an integrator
  I want every createService family to answer at /api/v1/{thing} and at
  /api/{thing}, with its dated and latest namespaces still reachable
  So that the URL I read in the documentation is the URL I should call, and
  nothing I already call stops answering

  Background:
    Given a service "things" with endpoints registered at "2026-01-15"
    And an override of one endpoint registered at "2026-08-07"

  @unimplemented
  Scenario: A dated URL is served by the latest registration on or before it
    When a caller requests /api/things/2026-03-01/things.list
    Then the "2026-01-15" registration answers
    And the response carries X-API-Version "2026-03-01"

  @unimplemented
  Scenario: The latest namespace serves the newest registrations
    When a caller requests /api/things/latest/things.list
    Then the "2026-08-07" registration answers
    And the response carries X-API-Version-Status "latest"

  @unimplemented
  Scenario: The preview namespace is separate from latest
    Given an endpoint registered only at preview
    When a caller requests it under latest
    Then it is not found
    And under preview it answers with X-API-Version-Status "preview"

  @unimplemented
  Scenario: The bare path serves the latest registrations
    When a caller requests /api/things/things.list with no version segment
    Then the "2026-08-07" registration answers
    And the response carries X-API-Version-Status "latest"

  @unimplemented
  Scenario: Every family answers at its /api/v1 path and its bare path
    When a caller requests /api/v1/things/things.list
    Then the same handler answers as at /api/things/things.list
    And both mounts carry the same access policy
    And the mount is reported once, carrying /api/v1/things/things.list as its
      canonical path

  @integration
  Scenario: A family already under /api/v1 is mounted once
    Given a family whose base path is /api/v1/agents
    When its routes are mounted
    Then no route is mounted at /api/v1/v1/agents
    And the family answers only at /api/v1/agents

  @integration
  Scenario: A v1-only family answers nowhere else
    Given a family that declares its published generation to be its whole contract
    When a caller addresses it at its bare path, a dated path, latest, or a date it never registered
    Then each of those is not found
    And only the /api/v1 address answers

  @unimplemented
  Scenario: The dated and latest namespaces answer under both prefixes
    When a caller requests /api/v1/things/2026-03-01/things.list
    Then the "2026-01-15" registration answers
    And /api/v1/things/latest/things.list serves the "2026-08-07" registration
    And the same two URLs answer without the /v1 segment

  @unimplemented
  Scenario: An unknown version namespace is rejected
    When a caller requests /api/things/2026-13-99/things.list
    Then the answer is 404 from the namespace guard
    And /api/v1/things/2026-13-99/things.list answers 404 from the same guard

  @unimplemented
  Scenario: Withdrawal answers 410 from its version onward
    Given "things.get" withdrawn at "2026-08-07"
    Then /api/things/2026-08-07/things.get answers 410 Gone
    And /api/things/2026-01-15/things.get still answers
    And the 410 response carries the version headers

  @unimplemented
  Scenario: Errors carry the version headers too
    When a request fails validation under a dated namespace
    Then the error response carries X-API-Version and X-API-Version-Status

  @integration
  Scenario: The dated and latest aliases are served but never documented
    Given the service declares documentable endpoints
    When the OpenAPI document is generated
    Then it contains a path for /api/v1/things/things.list
    And no documented path contains a dated namespace or the latest namespace
    And the bare /api/things/things.list address is not a second documented path

  @unimplemented
  Scenario: Preview never reaches the document
    Given an endpoint registered only at preview
    When the OpenAPI document is generated
    Then no documented path contains the preview namespace

  @unimplemented
  Scenario: One logical route reaches the document once
    When the OpenAPI document is generated
    Then the /api/v1 address carries the declared operation id
    And no dated, latest or bare address appears as a second operation

  @integration
  Scenario: A family serves one static generation instead of dated namespaces
    Given a family declares the generation its own namespace path already names
    When it is built
    Then its routes answer once, at that path
    And no dated namespace or latest alias is mounted beside them

  @integration
  Scenario: A family whose paths were never aliased declares no twin
    Given a dated family that declares it has no /api/v1 twin
    When its routes are mounted
    Then each route answers at its dated, its latest and its bare path
    And no /api/v1 address is registered for it, nor a version guard under one

  @integration
  Scenario: A path the family serves with another method answers 405, not 404
    Given a family serving one path with one method
    When a caller sends a method the family does not serve there
    Then the answer is 405, naming in Allow every method that path does serve
    And the same holds at the dated address, at latest, at the bare path and at the /api/v1 twin
    And a path the family serves with that method answers as it always did

  @integration
  Scenario: A method a later family serves on a path an earlier family guards is answered
    Given one family serving GET on "/:slug", mounted first
    And a later family serving POST on "/execute" under the same namespace
    When a caller sends POST to "/execute" at any of its addresses
    Then the later family's handler answers it
    And GET on a slug still answers from the earlier family

  @integration
  Scenario: A method no mounted family serves on a path answers 405 naming every family's methods
    Given two families serving one path with different methods
    When a caller sends a method neither serves there
    Then the answer is 405, naming in Allow every method any family serves on that path
    And HEAD on a path served by GET answers from the GET route

  @integration
  Scenario: A later family's versioned address is answered, not refused by an earlier family's version guard
    Given one family serving GET on "/:slug", mounted first
    And a later family serving POST on "/execute" under the same namespace
    When a caller sends POST to "/execute" at latest, at its dated version and at a later real date
    Then the later family's handler answers each of them

  @integration
  Scenario: A version no mounted family serves still answers 404 rather than reaching a dynamic route
    Given two families on one namespace, the later one serving POST on "/:slug/abort"
    When a caller sends POST to "/abort" under a date before every registration
    Then the answer is 404 and the dynamic route's handler never runs
    And the same route still answers at a real slug

  @integration
  Scenario: A family at a shared prefix mounts its own paths and their canonical address
    Given a family declares that its published paths are its whole contract
    When it is built
    Then each route answers at its literal path
    And each route also answers at the /api/v1 address of that same path
    And no dated namespace and no version guard is mounted
    And the route registry names the family for itself rather than for the shared prefix
    And nothing it mounts answers for a path it never declared, so a sibling under the
      same prefix answers as it always did
    And a route of such a family whose path is not a whole address is refused at declaration

  @integration
  Scenario: A family names a generation other than v1 in its own path
    Given a family whose protocol fixes the generation its path names
    When it declares that generation
    Then its routes answer under that generation and under no other
    And no dated namespace, latest alias or /api/v1 twin is mounted beside them
    And a generation named by a family that carries none in its path is refused
