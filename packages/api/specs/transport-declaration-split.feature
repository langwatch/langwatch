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
