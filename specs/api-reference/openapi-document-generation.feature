Feature: The OpenAPI document is generated from the route declarations and never committed
  As an integrator generating a client from the LangWatch API description
  I want the document to describe the routes the installed modules declare
  So that a generated call does not 404 against an operation the document promised

  # Every REST family is one `defineRestRouter(<F>Api)` carrying each route's
  # method, path, credential, permission and schemas. The generator mounts the
  # installed declarations on a REST host whose doors all refuse, and asks
  # hono-openapi for the document: nothing boots and no store opens. The api
  # builds the same document from the routes it mounted and serves it at
  # /api/openapi.json, /api/gateway/v1/openapi.json and /.well-known/openapi.
  #
  # The document is written to specs/api-reference/openapi-document.json, which
  # git ignores, by `pnpm --filter @langwatch/platform-api openapi:generate`.
  # The SDK clients and the docs site copy are generated from it and committed;
  # CI regenerates them and fails on a diff (the `openapi-clients` job).

  Rule: the generated document is the one the api serves

    @integration
    Scenario: The generator mounts exactly the route table the api serves
      Given the installed modules
      When the generator mounts their REST declarations
      Then its route table is the one the booted api serves

    @integration
    Scenario: The api serves the generated document
      Given the booted api
      When a caller reads /api/openapi.json
      Then the answer is the generated document

    @integration
    Scenario: Every documented operation is answered by the api
      Given the generated document
      When each operation is matched against the composed api application
      Then every documented operation has a route

    @integration
    Scenario: The generator writes only where the caller pointed it
      Given a caller that names an output path
      When the document is generated
      Then the document is written to that path
      And no other path is written

  Rule: the document names one canonical address per declared route

    # A family answers one operation at its bare path and at its /api/v1 twin,
    # and a dated family also at its dated and `latest` paths. OpenAPI cannot
    # say that one call has several addresses, so the document names the
    # /api/v1 twin, the URL an integrator is told to call.

    @integration
    Scenario: A declared route is published at its canonical v1 address
      Given a family addressed at a bare /api path with a /api/v1 twin
      When the document is generated
      Then the document lists the operation under its /api/v1 path
      And not under its bare, dated or latest path

  Rule: an operation states the id, the credential and the access its declaration names

    @unit
    Scenario: A published operation id outlives a renamed declaration
      Given a route whose docs name a published operation id
      When the document is generated
      Then the operation carries that id rather than the declared operation name

    @unit
    Scenario: An operation requiring a permission publishes the permission
      Given a route that declares an RBAC permission behind an organization door
      When the document is generated
      Then its x-access-policy names the organization key class and that permission

    @unit
    Scenario: Every published operation id is unique
      Given a route that answers both GET and HEAD under one declaration
      When the document is generated
      Then only its GET is published, carrying the id
