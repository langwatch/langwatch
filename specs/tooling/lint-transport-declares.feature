Feature: The transport-declares lint rule
  A transport declares; it never implements (ARCHITECTURE.md section 8). The
  framework parses, refuses and serialises, and a handler takes
  `{ input, app, actor, scope, signal }`, calls exactly one API operation, and
  returns a plain value or throws. The rule reads a module's process source
  three ways: every source for the process-only roots it may not build, the
  `transport/` folder for its handlers, and route families for the HTTP and
  tRPC machinery underneath the chain. Scenarios about route families live in
  api-transport-through-framework.feature.

  @unit
  Scenario: A handler reaching the raw request is reported at the field it takes
    Given a declared handler that destructures a raw context field and reads raw members through aliases
    When the transport-declares rule runs over it
    Then it reports rawContextField on the field's line and rawContextAccess on each access

  @unit
  Scenario: A handler that shapes the response itself is refused
    Given fluent route handlers that call json(), construct a Response, set a status, return NO_CONTENT or are not inline
    When the transport-declares rule runs over them
    Then each is reported on the line where it happens

  @unit
  Scenario: A handler calls exactly one operation on app
    Given handlers that call app twice, branch, or call app from a callback
    When the transport-declares rule runs over them
    Then it reports multipleOperationCalls, handlerControlFlow and nestedOperationCall where each happens

  @unit
  Scenario: A handler that constructs a service or repository is refused
    Given handlers that construct an App, a Service or a Repository, inline or named
    When the transport-declares rule runs over them
    Then it reports handlerConstructs naming the class

  @unit
  Scenario: A transport that bypasses the framework's typed boundary is refused
    Given a transport that registers raw Hono routes, reads a credential off the context bag or dispatches by string path
    When the transport-declares rule runs over it
    Then each is reported with the typed alternative
