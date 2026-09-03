Feature: The published OpenAPI document tracks the surface the API process serves
  As an integrator generating a client from the LangWatch API description
  I want the document to describe routes that answer
  So that a generated call does not 404 against an operation the document promised

  # The document at apps/api/src/features/discovery/openapi-document.json is a
  # FROZEN artifact: three routes serve it and both SDKs generate clients from
  # it. Its producer went with the retired monolith, so for a while nothing
  # regenerated it and nothing checked it — an operation could be added, or a
  # whole family could stop being mounted, and neither an integrator nor CI
  # would see it.
  #
  # What replaces the producer is a describer. It composes the process's OWN
  # mount — the same `createApiProcessRestFeatures` enumeration production
  # runs — over stand-in collaborators that refuse if a handler ever reaches
  # them, and describes what that mount registers. It writes to a path the
  # caller names, never to the artifact.
  #
  # The two directions of drift are not symmetrical, and that asymmetry is the
  # whole design: a removed route breaks a client that already exists, while an
  # undocumented route only means the frozen document is behind.

  Background:
    Given the OpenAPI document is frozen and served by three routes
    And the generator describes the families the API process mounts

  Rule: describing the surface never writes the frozen document

    @unit
    Scenario: The generator writes only where the caller pointed it
      Given a caller that names an output path
      When the description is generated
      Then the description is written to that path
      And the frozen document is byte-for-byte unchanged

    @unit
    Scenario: The checker writes only its scratch file
      Given a checker run against the frozen document
      When the check completes
      Then the frozen document is byte-for-byte unchanged

  Rule: the description covers every family the process mounts

    @unit
    Scenario: Every mounted family contributes its operations
      Given the process mounts its REST families over stand-in collaborators
      When the description is generated
      Then each family that publishes route descriptions appears in the document

    @unit
    Scenario: An operation no security scheme can express is left out and named
      Given a route reachable only by a browser session
      And the route carries a route description
      When the description is generated
      Then the operation is not published
      And the run reports it as unpublishable rather than publishing it unauthenticated

  Rule: a documented operation the process stopped serving fails the check

    @unit
    Scenario: A documented operation with no route behind it is reported as removed
      Given the frozen document lists an operation the process serves no route for
      When the check runs
      Then the operation is reported as removed
      And the check fails

    @unit
    Scenario: A served operation the document omits is reported and does not fail
      Given the process serves an operation the frozen document does not list
      When the check runs
      Then the operation is reported as added
      And the check still passes

    @unit
    Scenario: A documented operation served by an undescribed route is not a removal
      Given the frozen document describes an operation by hand
      And the process registers a route for it that carries no route description
      When the check runs
      Then the operation is reported as served and undescribed
      And it is not reported as removed

    @unit
    Scenario: An operation whose enforced credential moved is reported as changed
      Given the frozen document publishes one security requirement for an operation
      And the process now enforces a different credential class on that route
      When the check runs
      Then the operation is reported as changed with both requirements
