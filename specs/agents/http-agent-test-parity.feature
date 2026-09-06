Feature: Testing an HTTP agent exercises the same path that runs it
  As someone wiring an HTTP agent up to LangWatch
  I want the Test button to make the request the same way an evaluation will
  So that "the test passed" is a promise about the real run, not about a
  second, more forgiving client that only the test button uses.

  The Test button used to make its own request from the app: its own SSRF
  policy, its own template renderer, its own auth, timeout and JSONPath. An
  evaluation dispatched the agent as an HTTP node in the workflow engine. The
  two agreed often enough to look correct, and disagreed exactly where it hurt
  most: an agent on an internal address tested green and then failed the
  evaluation with a blocked-address error, because only the engine refused it.

  So the Test button now dispatches the same HTTP node the evaluation builds,
  through the same engine. There is one client, one policy, one renderer.

  Rule: A destination the test reaches is a destination the evaluation reaches

    @integration
    Scenario: an agent on an internal address that tests green also runs green
      Given local destinations are permitted
      And an HTTP agent whose URL points at an internal address
      When the agent is tested
      Then the test succeeds
      And running the same agent in an evaluation reaches the same endpoint

    @integration
    Scenario: an agent on an internal address that is refused is refused in the test too
      Given local destinations are blocked
      And an HTTP agent whose URL points at an internal address
      When the agent is tested
      Then the test fails with a blocked-address error
      And the failure reads as a refused address, not as an unreachable service
      # Telling the author to check that their service is running sends them to
      # debug an endpoint that is running and was never dialed.

    # Refusing the destination is the engine's, so the covering test is Go's
    # (httpblock: TestSSRF_WhenLocalDestinationsArePermitted, "still refuses
    # cloud metadata"). @unimplemented because the parity checker only scans TS
    # test roots and cannot bind a Go test yet — the behaviour is covered, the
    # binding is not.
    @unit @unimplemented
    Scenario: cloud metadata is refused by the test button
      Given an HTTP agent whose URL points at a cloud metadata endpoint
      When the agent is tested
      Then the test fails with a blocked-address error
      And no request is made to the metadata endpoint

  Rule: The body the test sends is the body the engine rendered

    The panel used to render the body in the browser with a plain text
    substitution, so a template written the way the engine expects it
    ("{{ input }}", with spaces) was left untouched and sent to the endpoint
    with the braces still in it. The author saw a green test and a confused
    endpoint.

    @integration
    Scenario: a template written with spaces around the variable is substituted
      Given an HTTP agent whose body template is "{\"q\": \"{{ input }}\"}"
      When the agent is tested with input "hello"
      Then the endpoint receives the body {"q": "hello"}

    @integration
    Scenario: the panel shows the body the engine actually sent
      Given an HTTP agent whose body template references a variable
      When the agent is tested
      Then the rendered body reported back is the one the endpoint received

    @unit
    Scenario: a variable the template references but the test does not supply is reported
      Given an HTTP agent whose body template references an unsupplied variable
      When the agent is tested
      Then the test reports the unresolved variable as a warning

  Rule: The response detail the panel shows comes from the engine

    @integration
    Scenario: a successful test reports status, duration and response headers
      Given an HTTP agent whose endpoint answers 200 with a JSON body
      When the agent is tested
      Then the test reports the status 200
      And the test reports how long the request took
      And the test reports the response headers the endpoint sent

    @integration
    Scenario: a non-2xx response fails the test and keeps the upstream body
      Given an HTTP agent whose endpoint answers 500 with a diagnostic body
      When the agent is tested
      Then the test fails
      And the test reports the status 500
      And the upstream body is shown so the author can read the endpoint's complaint

    # Selecting the output is the engine's (httpblock: TestExtractJSONPath_*),
    # so these two are covered in Go and unbound here for the same reason as
    # the metadata scenario above.
    @integration @unimplemented
    Scenario: the configured output path selects what the test reports as output
      Given an HTTP agent whose output path is "$.choices[0].message.content"
      And an endpoint answering a nested JSON payload
      When the agent is tested
      Then the extracted output is the value at that path

    @unit @unimplemented
    Scenario: an output path matching nothing fails the test rather than reporting empty
      Given an HTTP agent whose output path matches nothing in the response
      When the agent is tested
      Then the test fails naming the path that matched nothing

  Rule: Credentials configured on the agent never come back to the browser

    The test response carries the request it made so the author can debug it.
    That request has the agent's credentials attached, so what comes back is
    redacted, whatever the auth scheme.

    @unit
    Scenario Outline: the auth secret is not present in the test response
      Given an HTTP agent using <scheme> authentication
      When the agent is tested
      Then the test response does not contain the secret

      Examples:
        | scheme  |
        | bearer  |
        | api key |
        | basic   |
