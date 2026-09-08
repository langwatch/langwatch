# See ../adrs/20260908-transport-declaration-split.md and
# dev/docs/plans/api-transport-split.md.
Feature: Transport declaration split
  A feature's contract declares each tRPC procedure once: its name, kind, input and
  output. The feature's server binds a permission and a handler to a procedure the
  contract already named. REST stays one complete endpoint per route, declared in the
  server. Each transport has one runtime, built by the process from its own ports, and
  a declaration is mounted on it; a feature declaration carries no runtime import and
  never carries the process's tRPC generics.

  @unit @architecture
  Scenario: A contract declares a procedure once, in a browser-safe module
    Given a contract module built with defineTrpcContract from @langwatch/api/contract
    When it declares a query with an input and an output schema and a mutation with only an input
    Then the module's value-import graph reaches no server framework, tRPC server runtime or Node API
    And the declaration carries the procedure names, kinds and schemas as types the browser can read

  @unit @typecheck
  Scenario: A server implementation may only name procedures the contract declared
    Given a server router built with defineTrpcRouter over a feature API token and its contract
    When it selects a procedure name the contract does not declare
    Then the router does not compile

  @unit @typecheck
  Scenario: A procedure cannot be implemented twice or left unimplemented
    Given a contract declaring two procedures
    When the server implements one of them twice, or builds with one of them missing
    Then the router does not compile
    And the build names the procedure that was duplicated or omitted

  @unit @typecheck
  Scenario: A procedure without an access decision has no handler to call
    Given a server selects a declared procedure
    When it calls handle before withPermission, noPermission or serviceAuthorized
    Then the router does not compile

  @unit @typecheck
  Scenario: The server repeats nothing the contract said
    Given a declared query with an input and an output schema
    When the server implements it
    Then the handler's input parameter is the contract's parsed input type
    And a handler that returns a value for a procedure declared without output does not compile
    And a handler whose return the output schema refuses does not compile

  @unit
  Scenario: A tRPC call runs one execution path
    Given a mounted contract procedure with a permission
    When a caller invokes it
    Then the framework authenticates, parses the input, authorizes the exact declared target, runs the handler, checks the output and serializes, in that order
    And the handler receives input, app, actor, scope and signal, and nothing else
    And a fact the process's mount resolved reaches the handler beside input, never inside it

  @unit
  Scenario: A tRPC check reads the validated input, never the unparsed request
    Given a mounted contract procedure whose declaration names a scope field
    When the process installs its tracing, logging, error boundary, check and audit trail
    Then each of them runs after the contract's own parser
    And a request the parser refuses is answered as a bad request, before any check runs
    And the access decision reaches the handler through the request context the check extended, not through the caller's own object

  @unit
  Scenario: A mutation is recorded with the arguments its owner redacted
    Given a mounted contract mutation and a process that records audit rows
    When a caller invokes it
    Then one row is written naming the caller, the procedure, and the scope ids the input carried
    And the arguments on the row are the ones the process's redaction answered
    And a procedure the process exempts writes no row

  @unit
  Scenario: A process mounts a declaration on the runtime it built
    Given a process that composed one runtime per transport from its own ports
    When it mounts a feature's declaration and names the application slice to bind
    Then the declaration itself names no root, no port and no application
    And the feature's server and contract value-import no runtime

  @unit
  Scenario: An output the declaration refuses is diagnosed without leaking the response
    Given a procedure whose handler answers a shape its output schema refuses
    When the process asks for outputs to be checked
    Then the failure is logged with the procedure name, the issue path and request metadata
    And the log carries no response contents
    And the caller still receives the handler's answer

  @unit @typecheck
  Scenario: The browser derives its client from the contract
    Given a contract built with defineTrpcContract
    When a web package derives its typed client from the contract's type
    Then each procedure's input and output types are the contract's, and no hand-written map is needed
    And the web package names no AppRouter

  @unit
  Scenario: A REST endpoint is one complete declaration in the server
    Given a server router built with defineRestRouter over a feature API token
    When it declares a namespace, a version and a route with method, path, params, permission, output and docs
    Then a params schema whose keys differ from the path's parameters does not compile
    And a route without a permission has no handler to call
    And a route declared without output is served as 204 with an empty body

  @unit
  Scenario: A REST request is parsed before its credential is resolved
    Given a mounted REST declaration whose door resolves a project credential
    When a caller sends a request the declared schemas refuse
    Then the refusal is answered without the door ever resolving the credential
    And a request the schemas accept resolves the credential, then decides, then runs the handler
    And the credential is marked used only after the handler has answered

  @unit
  Scenario: A declared route answers at every address its family already served
    Given a REST declaration mounted under its namespace and version
    When a caller addresses it by its dated path, by latest, by the bare path or by the /api/v1 twin
    Then each answers the same, and names the version it answered and that version's status
    And a real date the router never registered is served by the registration before it
    And a version segment that names no servable version is refused

  @integration
  Scenario: A collection route is addressed at the family root, with no trailing slash
    Given a REST declaration carrying a collection route and a by-id route beside it
    When a caller addresses the collection by its dated path, by latest, by the bare path or by the /api/v1 twin
    Then no address the family registers ends in a slash
    And each one reaches the collection handler rather than the by-id handler

  @integration
  Scenario: A declared body cap is measured before the body is parsed
    Given a route declaring both a body cap and a body schema
    When a caller sends a body under the cap
    Then the route is served
    And a body over the cap is refused as the declared refusal, with the status that refusal carries
    And neither answer is a server fault

  @integration
  Scenario: A route's declared tags reach the published document
    Given a route whose docs name the groups it belongs to
    When the process publishes the OpenAPI document
    Then the operation is filed under exactly those tags

  @integration
  Scenario: A route's declared responses reach the published document
    Given a route whose docs name an answer beyond the one it declares on success
    When the process publishes the OpenAPI document
    Then the operation lists that answer beside its success, with the status's own name

  @integration
  Scenario: A route's declared facts are bound once at the mount and reach every handler
    Given routes declaring facts the process resolves, rather than the caller sends
    When the process mounts the declaration and binds one value for each fact
    Then each handler is handed the facts it declared, parsed, in the order it declared them
    And every address the route answers at resolves them the same way
    And a mount that bound no value for a declared fact is refused, naming the fact and the route

  @unit
  Scenario: A declaration names the credential its routes accept
    Given a REST declaration built with defineRestRouter
    When it names the door its routes answer behind, before its first route
    Then the declaration carries that credential, and one that names none carries the project key
    And a door named after the first route is refused, because the routes are already typed

  @unit @typecheck
  Scenario: A handler on an organization door receives the organization scope
    Given a declaration that names the organization door
    When a route on it reads the scope it is handed
    Then the scope is the organization the credential resolved
    And the same route on a project door does not compile
    And a door for a credential nothing resolves a scope for does not compile

  @unit
  Scenario: A mount cannot answer a declaration behind the other door
    Given a declaration that names the organization door
    When a process mounts it naming the project credential instead
    Then the mount is refused, naming the declared door and the one the mount named

  @integration
  Scenario: An organization id the credential did not resolve is a handled refusal
    Given a credential that resolved one organization
    When the request body names a different organization
    Then the caller is refused as forbidden, with a stable code a client renders copy from
    And the refusal names the offending field and neither organization
    And a body naming the organization the credential resolved is served

  @integration
  Scenario: A door that resolves the wrong tier is a wiring failure, not an answer
    Given a declaration that names the organization door
    When the process's own door resolves a project instead
    Then the request fails rather than handing a project scope to an organization handler

  @integration
  Scenario: An organization route publishes the organization security scheme
    Given a route declared behind the organization door
    When the process mounts it and reads the route registry
    Then the route records the organization credential class
    And the class publishes the organization API key scheme in the document

  @unimplemented
  Scenario: A project key presented to an organization route is refused with the body the family already publishes
    Given a family declared behind the organization door
    When a caller presents a project API key
    Then the door refuses it as a credential class mismatch, naming the key class required
    And a request carrying no credential at all is refused as missing credentials

  @unit
  Scenario: A project id the credential did not resolve is a handled refusal
    Given a credential that resolved one project
    When the request body names a different project
    Then the caller is refused as forbidden, with a stable code a client renders copy from
    And the refusal names the offending field and neither project

  @integration
  Scenario: The declarations publish the OpenAPI document
    Given a REST router declared with docs on every route
    And its application provider refuses resolution before the process boots
    When the process mounts it under its namespace and version
    Then every route appears in the OpenAPI document under that namespace and version with its summary
    And no route is documented that the router did not declare
    And mounting and documenting routes never resolve the application provider

  @unit
  Scenario: Handled failures cross the boundary as handled errors
    Given a handler throws a HandledError with a stable code
    When the transport answers
    Then the wire carries the code and the declared HTTP status
    And a plain Error degrades to the generic unknown answer with a trace id

  @unit @architecture
  Scenario: A feature declaration carries no process generics
    Given annotation's contract, server transports and web client are written against the split
    When their sources are read
    Then none names TContext, TRoot, TOptions, a mount type or a tRPC root
    And the process mount binds the framework's request context on its own side
