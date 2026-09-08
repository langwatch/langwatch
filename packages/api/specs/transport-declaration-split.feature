# See ../adrs/20260908-transport-declaration-split.md and
# dev/docs/plans/api-transport-split.md. Scenarios are tagged @unimplemented until
# the test that binds them exists; remove the tag in the same change as the test.
Feature: Transport declaration split
  A feature's contract declares each tRPC procedure once: its name, kind, input and
  output. The feature's server binds a permission and a handler to a procedure the
  contract already named. REST stays one complete endpoint per route, declared in the
  server. Both transports run one execution path through the framework's own request
  context; a feature declaration never carries the process's tRPC generics.

  @typecheck @architecture @unimplemented
  Scenario: A contract declares a procedure once, in a browser-safe module
    Given a contract module built with defineTrpcContract from @langwatch/api/contract
    When it declares a query with an input and an output schema and a mutation with only an input
    Then the module's value-import graph reaches no server framework, tRPC server runtime or Node API
    And the declaration carries the procedure names, kinds and schemas as types the browser can read

  @typecheck @unimplemented
  Scenario: A server implementation may only name procedures the contract declared
    Given a server router built with defineTrpcRouter over a feature API token and its contract
    When it selects a procedure name the contract does not declare
    Then the router does not compile

  @typecheck @unimplemented
  Scenario: A procedure cannot be implemented twice or left unimplemented
    Given a contract declaring two procedures
    When the server implements one of them twice, or builds with one of them missing
    Then the router does not compile
    And the build names the procedure that was duplicated or omitted

  @typecheck @unimplemented
  Scenario: A procedure without an access decision has no handler to call
    Given a server selects a declared procedure
    When it calls handle before withPermission, noPermission or serviceAuthorized
    Then the router does not compile

  @typecheck @unimplemented
  Scenario: The server repeats nothing the contract said
    Given a declared query with an input and an output schema
    When the server implements it
    Then the handler's input parameter is the contract's parsed input type
    And a handler that returns a value for a procedure declared without output does not compile
    And a handler whose return the output schema refuses does not compile

  @unit @unimplemented
  Scenario: A tRPC call runs one execution path
    Given a mounted contract procedure with a permission
    When a caller invokes it
    Then the framework authenticates, parses the input, authorizes the exact declared target, runs the handler, checks the output and serializes, in that order
    And the handler receives input, app, actor, scope and signal, and nothing else
    And a parsed middleware fact reaches the handler as a trailing argument, never inside input

  @unit @unimplemented
  Scenario: An output the declaration refuses is diagnosed without leaking the response
    Given a procedure whose handler answers a shape its output schema refuses
    When the process asks for outputs to be checked
    Then the failure is logged with the procedure name, the issue path and request metadata
    And the log carries no response contents
    And the caller still receives the handler's answer

  @typecheck @unimplemented
  Scenario: The browser derives its client from the contract
    Given a contract built with defineTrpcContract
    When a web package derives its typed client from the contract's type
    Then each procedure's input and output types are the contract's, and no hand-written map is needed
    And the web package names no AppRouter

  @typecheck @unimplemented
  Scenario: A REST endpoint is one complete declaration in the server
    Given a server router built with defineRestRouter over a feature API token
    When it declares a namespace, a version and a route with method, path, params, permission, output and docs
    Then a params schema whose keys differ from the path's parameters does not compile
    And a route without a permission has no handler to call
    And a route declared without output is served as 204 with an empty body

  @integration @unimplemented
  Scenario: The declarations publish the OpenAPI document
    Given a REST router declared with docs on every route
    When the process mounts it under its namespace and version
    Then every route appears in the OpenAPI document under /api/<version>/<namespace> with its summary
    And no route is documented that the router did not declare

  @unit @unimplemented
  Scenario: Handled failures cross the boundary as handled errors
    Given a handler throws a HandledError with a stable code
    When the transport answers
    Then the wire carries the code and the declared HTTP status
    And a plain Error degrades to the generic unknown answer with a trace id

  @typecheck @architecture @unimplemented
  Scenario: A feature declaration carries no process generics
    Given annotation's contract, server transports and web client are written against the split
    When their sources are read
    Then none names TContext, TRoot, TOptions, a mount type or a tRPC root
    And the process mount binds the framework's request context on its own side
