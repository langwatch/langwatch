Feature: The published OpenAPI document is generated from the module declarations
  As an integrator generating a client from the LangWatch API description
  I want the document to describe the routes the installed modules declare
  So that a generated call does not 404 against an operation the document promised

  # The document at apps/api/src/features/discovery/openapi-document.json is a
  # FROZEN artifact: three routes serve it and both SDKs generate clients from
  # it. Its first producer read a doors table and composed the whole API
  # process over stand-in collaborators that refused if a handler reached them,
  # which meant a family whose stand-in was wrong left the document silently.
  #
  # The producer now reads the module declarations instead. Every REST family
  # is one `defineRestRouter(<F>Api)` carrying each route's method, path,
  # credential, permission and schemas, and the union of the installed
  # declarations IS the document. Nothing on that path boots a process, opens a
  # client or resolves a member.
  #
  # The two directions of drift are not symmetrical, and that asymmetry is the
  # whole design: a removed route breaks a client that already exists, while an
  # undocumented route only means the frozen document is behind.

  Background:
    Given the OpenAPI document is frozen and served by three routes
    And the generator describes the families the installed modules declare

  Rule: describing the declarations never writes the frozen document

    @unit
    Scenario: The generator writes only where the caller pointed it
      Given a caller that names an output path
      When the description is generated
      Then the description is written to that path
      And no other path is written

    @unit
    Scenario: The checker writes only its scratch file
      Given a checker run against the frozen document
      When the check completes
      Then the frozen document is byte-for-byte unchanged

  Rule: every declared route is described or accounted for by its own declaration

    # A route absent because its declaration says so is a decision. A route
    # absent because nothing could read its declaration is a hole that reads,
    # in a document diff, exactly like a deletion.

    @unit
    Scenario: Every declared route contributes its operation
      Given a family declaring a list, a read and a create
      When the description is generated
      Then the document publishes one operation for each of them
      And the run reports how many families and routes it read

    @unit
    Scenario: A route its declaration hides is left out and named
      Given a family with one route the declaration hides
      When the description is generated
      Then the hidden operation is not published
      And the run reports it against the declaration that hid it

    @unit
    Scenario: A family behind a browser session publishes nothing
      Given a family whose door is a browser session
      When the description is generated
      Then the family publishes no operation, because no API client holds a cookie
      And the run still counts the routes it read

    @unit
    Scenario: An operation no security scheme can express is dropped and named
      Given a published family holding one route that raises a browser door itself
      When the description is generated
      Then that operation is not published
      And the run reports it as unpublishable rather than publishing it unauthenticated

    @unit
    Scenario: A module whose declaration cannot be read fails the run
      Given an installed module whose REST router throws
      When the installed declarations are collected
      Then the run fails naming the module
      And no family is silently dropped

    @unit
    Scenario: A router handing back something that is not a declaration fails the run
      Given an installed module whose REST router returns a bare object
      When the installed declarations are collected
      Then the run fails naming the module

    @unit
    Scenario: A tRPC transport beside a REST one is passed over
      Given an installed module declaring both a tRPC and a REST transport
      When the installed declarations are collected
      Then only the REST family is read

  Rule: the document names one canonical address per declared route

    # A dated family answers one operation at three addresses — its dated path,
    # its `latest` path and its bare path — and each is the same call reached
    # through a different version selector. OpenAPI cannot say that, so
    # publishing all three would hand a client generator three names for one
    # call. The document names the bare address at its `/api/v1` twin, which is
    # the URL an integrator is told to call.

    @unit
    Scenario: A declared route is published at its canonical v1 address
      Given a family addressed at a bare /api path with a /api/v1 twin
      When the description is generated
      Then the document lists the operation under its /api/v1 path

    @unit
    Scenario: A collection route is addressed at the family root
      Given a route whose declared path is the family root
      When its published address is computed
      Then it is the family's own address with no trailing segment

    @unit
    Scenario: A path parameter is spelled the way the document spells it
      Given a route whose declared path names a parameter
      When its published address is computed
      Then the parameter is written in braces

    @unit
    Scenario: A family with no v1 twin keeps the address it declares
      Given a family addressed literally that opted out of the /api/v1 alias
      When the description is generated
      Then the document lists its operations at the paths the routes write

    @unit
    Scenario: Two declarations cannot publish at one address
      Given two families whose declarations resolve to one published address
      When the surface is composed
      Then the run fails naming the address and both claimants

  Rule: every published operation states the credential and the access it declares

    # An operation publishes the security scheme a caller presents, and beside
    # it an `x-access-policy` extension saying what that credential has to
    # hold. The policy carries no prose reason: that describes how a handler is
    # built, and the document is read by customers.

    @unit
    Scenario: A family behind a project key publishes the project scheme
      Given a family whose declared door is a project credential
      When the description is generated
      Then its operations require the project API key scheme

    @unit
    Scenario: A family behind an organization key publishes the admin scheme
      Given a family whose declared door is an organization credential
      When the description is generated
      Then its operations require the admin API key scheme

    @unit
    Scenario: A family behind the deployment's own secret is published, not dropped
      Given a family whose declared door is the internal shared secret
      When the description is generated
      Then its operations require the internal scheme

    @unit
    Scenario: An operation requiring a permission publishes the permission
      Given a route that declares an RBAC permission
      When the description is generated
      Then the operation publishes that permission beside its credential class

  Rule: an operation carries the prose and the shapes its declaration wrote

    @unit
    Scenario: The declared operation id and summary are published
      Given a route that declares an operation name and a summary
      When the description is generated
      Then both appear on the published operation

    @unit
    Scenario: A declared path parameter is published
      Given a route that parses a path parameter
      When the description is generated
      Then the operation lists it as a required path parameter

    @unit
    Scenario: A declared request body is published as JSON Schema
      Given a route that declares an input schema
      When the description is generated
      Then the operation publishes that shape as its JSON request body

  Rule: a documented operation no declaration publishes fails the check

    @unit
    Scenario: A documented operation with no declaration behind it is reported as removed
      Given the frozen document lists an operation no installed family declares
      When the check runs
      Then the operation is reported as removed
      And it is counted as a regression

    @unit
    Scenario: A removal already at the baseline is inherited, not caused
      Given the checker's baseline names the removed operation
      When the check runs
      Then the operation is reported as baselined rather than as a regression

    @unit
    Scenario: A declared operation the document omits is reported and does not fail
      Given a declaration publishing an operation the frozen document does not list
      When the check runs
      Then the operation is reported as added
      And the check still passes

    @unit
    Scenario: A documented operation whose declaration hides it is not a removal
      Given the frozen document describes by hand an operation its declaration hides
      When the check runs
      Then the operation is reported as declared and undescribed
      And it is not reported as removed

    @unit
    Scenario: An operation whose enforced credential moved is reported as changed
      Given the frozen document publishes one security requirement for an operation
      And the declaration now names a different credential for that route
      When the check runs
      Then the operation is reported as changed with both requirements

    @unit
    Scenario: The rendered report names every operation the run would fail on
      Given a check run holding a regression
      When the report is rendered for a terminal
      Then it names the operation
