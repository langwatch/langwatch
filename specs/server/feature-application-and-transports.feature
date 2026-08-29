# The feature application, and the two doors onto it
# Covers: the per-feature App class, the typed request context (app + auth),
# and the endpoint builder both transports declare through
#
# A feature answers over two transports. They are different usages — different
# endpoints, different wire shapes, different pagination, different limits —
# but they are one implementation, because a rule that exists twice answers
# differently the first time one copy changes.
#
# The feature's App holds every service and port the feature needs and exposes
# the operations both doors call. It reaches a handler as `c.app`. Who is
# calling reaches it as `c.auth`. Both are typed from what the composition root
# supplied, so a handler cannot read something the process never provided, and
# cannot believe a shape nobody wrote down.
#
# Endpoints are declared, never assembled: a builder takes the input schema,
# the output schema and the access policy, and then the handler. Anything the
# framework can own — status codes, envelopes, error mapping, tracing, audit —
# the framework owns.

Feature: The feature application and its transports
  A feature composes one application from its own services and ports, and
  serves it through a REST door and a tRPC door that work the same way.

  # ─── The application ────────────────────────────────────────────────────

  @unimplemented @unit
  Scenario: The application holds every service and port the feature needs
    Given a feature package with services, ports and repositories
    When its application is composed at a composition root
    Then it receives every service and port the feature's operations use
    And no transport composes a dependency of its own

  @unimplemented @unit
  Scenario: One rule serves both doors
    Given an operation both transports expose
    When the REST door and the tRPC door each invoke it
    Then both reach the same implementation on the application
    And neither door can reach a different answer by branching on its own

  @unimplemented @unit
  Scenario: A door may shape what it asks for without forking the rule
    Given a public endpoint that pages with cursors and a smaller limit ceiling
    And an internal endpoint over the same operation that pages by offset
    When each door calls the application
    Then each supplies its own paging and limit arguments
    And the operation that answers them is the same one

  # ─── The typed context ──────────────────────────────────────────────────

  @unimplemented @unit
  Scenario: The context exposes the application the composition root supplied
    Given a transport composed with a feature application
    When a handler reads the application off its context
    Then the type it sees is the application that was supplied
    And an operation the application does not expose fails to compile

  @unimplemented @unit
  Scenario: The context exposes the caller as the authentication resolved them
    Given a request authenticated by the process's own authentication
    When a handler reads the caller off its context
    Then the type it sees is what that authentication resolves to
    And it is not a shape restated anywhere downstream

  @unimplemented @unit
  Scenario: A handler cannot reach request state by name
    Given a handler in a feature package
    When it needs the project, the caller or a service
    Then it reads them from the typed context
    And no string-keyed lookup is available to it

  # ─── Declaring an endpoint ──────────────────────────────────────────────

  @unimplemented @unit
  Scenario: An endpoint declares its input, its output and its access policy
    Given an endpoint being declared on either transport
    When any of the input schema, the output schema or the access policy is absent
    Then the endpoint does not compile

  @unimplemented @unit
  Scenario: A handler receives validated input and returns a value
    Given an endpoint with a declared input schema
    When a request arrives
    Then the handler receives input already validated against that schema
    And it returns a value rather than composing a response

  @unimplemented @unit
  Scenario: A handler is given input only when input was declared
    Given an endpoint that declares no input schema
    Then its handler is given no input to read
    And an endpoint that declares one gives its handler the validated input

  @unimplemented @unit
  Scenario: A handler may answer only when output was declared
    Given an endpoint that declares no output schema
    Then its handler answers with nothing
    And returning a value from it does not compile

  @unimplemented @unit
  Scenario: Answering requires an output schema
    Given an endpoint whose handler returns a value
    When no output schema is declared
    Then the endpoint does not compile

  # ─── Authorization is bound to what the request names ───────────────────

  @unimplemented @unit
  Scenario: An endpoint naming a scope must bind its permission to it
    Given an endpoint whose input names a project, team, organization or user
    When it declares a permission without saying which input names the scope
    Then the endpoint does not compile

  @unimplemented @unit
  Scenario: The bound scope must be one the input actually declares
    Given an endpoint that binds its permission to an input field
    When that field is not in the input schema
    Then the endpoint does not compile

  @unimplemented @integration
  Scenario: A caller may not reach a scope their credential does not cover
    Given a caller holding a permission in their own project
    And a request naming a different project in its input
    When the request reaches either transport
    Then it is refused
    And the refusal does not disclose whether the named project exists

  @unimplemented @unit
  Scenario: Authorization is decided after the input is validated
    Given an endpoint whose permission is bound to an input field
    Then the scope is read from the validated input
    And never from the unvalidated request

  @unimplemented @unit
  Scenario: The transport owns the response
    Given a handler that returns a value
    Then the framework renders it for that transport
    And the handler never names a status code, an envelope or a content type

  @unimplemented @unit
  Scenario: The transport owns the failure
    Given a handler that throws a handled error
    Then the framework maps it to that transport's refusal, with its code
    And a handler never constructs a transport error of its own

  # ─── What the two doors share, and what they do not ─────────────────────

  @unimplemented @unit
  Scenario: Both doors declare an endpoint the same way
    Given a REST endpoint and a tRPC procedure over the same operation
    Then each declares input, output and access policy in that order
    And each hands off to the application in its handler

  @unimplemented @integration
  Scenario: A permission is enforced identically on both doors
    Given an operation guarded by a permission
    When a caller without that permission reaches it over REST
    And the same caller reaches it over tRPC
    Then both refuse
    And both refuse with the same error code
