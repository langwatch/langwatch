@unit
Feature: mcpsim, a simulator of MCP clients against the hosted MCP endpoint
  mcpsim stands in for the MCP clients people connect to LangWatch (Claude
  Code, Claude Desktop, Cursor). It drives the stack's hosted MCP endpoint the
  way they do, on /mcp and on /sse, with a project API key or with the OAuth
  flow (discovery, client registration, PKCE, approval, code exchange,
  refresh). Each named scenario is one run that records every exchange as a
  step, with its status and latency, and a check per expectation; a run passes
  only when every check passed. haven runs it on request and drives it through
  /_sim/api, and its console shows the runs.

  # Bound by Go tests in services/sims/mcpsim/mcpsim_test.go (against a fake
  # LangWatch in fake_test.go), tools/thuishaven/domain/selection_mcp_test.go,
  # tools/thuishaven/app/plan_mcp_test.go, tools/thuishaven/cmd/sim_mcp_test.go
  # and cmd/service/combined_dev_test.go, by their `// @scenario` annotations,
  # and by apps/sims/src/mcp/__tests__.

  Rule: The API key flow

    Scenario: A client connects with a project API key on /mcp and /sse
      Given an endpoint that accepts the stack's project API key
      When the connect scenario runs with no transport named
      Then it runs on both /mcp and /sse
      And on each it initializes, sends notifications/initialized, lists tools, calls fetch_langwatch_docs and ends the session with DELETE
      And each of those answers is recorded as a step
      And a check per transport passes for the initialize, the tool list, the tool call and the DELETE
      And the run passes whether the endpoint answers in JSON or in an SSE body

    Scenario: A wrong API key fails the run with the challenge reported
      When the connect scenario runs on /mcp with a key the endpoint refuses
      Then the run fails
      And its initialize step records the 401 and the challenge's resource_metadata

    Scenario: A 503 from the endpoint is retried with backoff
      Given an endpoint that answers the first two requests 503 with Retry-After: 0
      When the connect scenario runs on /mcp
      Then each 503 is recorded as a step that waits as Retry-After asked
      And the run passes once the endpoint answers
      And without a Retry-After the wait is 250ms, doubling on each retry

  Rule: Sessions

    Scenario: The event stream is held, and a dropped one is reported
      Given an endpoint that drops the GET event stream after 100ms
      When the stream scenario holds it for a second
      Then the run fails with the one check saying the stream dropped after so long
      And the session still answers after the stream
      When the endpoint stops dropping streams
      Then the stream scenario on /sse passes

    Scenario: A lost session answers 404 and the client re-initializes without a new sign-in
      When the reconnect scenario runs on /mcp and /sse
      Then on each, a session id the endpoint never issued and one it has ended both answer 404
      And after each, re-initializing with the same credentials works with no refresh and no sign-in
      And the run passes

    Scenario: A lost session answered with 401 is reported as a failure
      Given an endpoint that answers 401 for a session it does not know
      When the reconnect scenario runs
      Then the run fails
      And the failed check says a spec client would start a new sign-in for a session that is merely gone

    Scenario: An idle client whose session was lost re-initializes silently
      Given the endpoint forgets every session while the client idles
      When the idle scenario runs
      Then the first tools/list after the idle answers 404
      And the client initializes again and the session answers after the idle
      And the run passes

    Scenario: A soak runs concurrent clients and counts what they did
      Given an endpoint that answers one request 503
      When the soak scenario runs four clients over both transports for 1.5 seconds
      Then the run passes
      And its load counts four clients, at least four sessions and eight requests, one retry, the answers by status and the latency

  Rule: The OAuth flow

    Scenario: An OAuth connect discovers, registers, gets approval and exchanges the code
      Given a LangWatch session cookie
      When the OAuth connect runs with automatic approval
      Then the 401 challenge, the metadata discovery, the client registration, the approval and the token exchange each succeed as a step
      And the authorization server's metadata offers PKCE S256, and the code exchange presents the matching verifier
      And the new access token opens a session and lists tools
      And the sim holds the grant, reporting its client id and only a masked access token
      And the connect scenario on the OAuth flow then passes

    Scenario: An interactive OAuth connect waits for a person to approve in the browser
      When the OAuth connect runs in interactive mode
      Then it answers 202, waiting, with an authorize URL on /mcp/authorize
      And the URL asks for PKCE S256 and redirects to the sim's /callback
      When a person approves and the browser lands on the callback
      Then the connect passes

    Scenario: The sim signs in itself with the configured local login
      Given the sim is configured with a local email and password
      Then its status says it approves by signing in as that email, and never shows the API key
      When the OAuth connect runs with no cookie
      Then it signs in once, approves with that session and passes

    Scenario: A refresh mid-session keeps the same session
      Given an OAuth grant
      When the refresh scenario runs
      Then the refresh answers a new access token
      And the same session id answers with the new token
      And the grant counts one refresh

    Scenario: An expired access token is refreshed and the request retried
      Given an OAuth grant whose access token expires while the client idles
      When the idle scenario runs on the OAuth flow
      Then the next tools/list answers 401
      And the client refreshes the token and the request then answers
      And the run passes

    Scenario: Two concurrent refreshes pass only inside the server's retry window
      Given an OAuth grant
      When two refreshes redeem the same refresh token at once and the server answers a repeat with the same pair
      Then both answer the same new token pair and the run passes
      When the server refuses a refresh token used once already
      Then the run fails, naming the refresh token already used
      And the pair the other refresh answered is kept, so the OAuth flow goes on working

    Scenario: Authorization-server metadata is looked up at the issuer's well-known address
      Then an issuer with no path is looked up at /.well-known/oauth-authorization-server
      And an issuer with a path has the well-known segment inserted before that path

    Scenario: An answer in an SSE body is found among pings and other messages
      Given an SSE body with a comment, an answer to another request and a multi-line answer to this one
      Then the sim reads this request's answer from it
      And a body with no answer is reported as unanswered
      And a line longer than 1 MiB is refused rather than buffered

  Rule: Credentials and the control API

    Scenario: Held credentials only go to the endpoint they belong to
      Given a run or a connect aimed at an endpoint other than the configured one
      Then the configured API key is not sent there: the run is refused for want of a key
      And the OAuth grant's token is not sent there: the run is refused, naming the endpoint that issued it
      And the configured session cookie is not sent there: the connect fails with no approval asked of it
      And the configured login is not sent there: the connect fails with no sign-in or approval asked of it

    Scenario: The control API takes JSON only
      When a run or an OAuth connect is posted as text/plain
      Then the sim answers 415 and starts no run

    Scenario: The sim answers only on this machine
      Then mcpsim listens on loopback by default, and haven gives it a loopback address too
      When a request names a host that is not this machine, as a rebound DNS name does
      Then the sim answers 403 and starts no run
      But a request to localhost, 127.0.0.1 or a *.localhost name is served

    Scenario: A run request the sim cannot run is refused before it starts
      When a run names an unknown scenario, an OAuth-only scenario on the API key flow, the OAuth flow with no grant, an unknown transport, too many soak clients, or another endpoint with no key
      Then each answers 400 with the reason
      And no run starts

    Scenario: Runs are listed newest first, bounded and cleared
      Given two runs have finished
      Then the run list names them newest first, without their steps
      And /_sim/api/runs/latest returns the newest with its steps
      And clearing the runs leaves none
      And a run keeps at most 1000 steps, counting the ones it dropped

  Rule: haven

    Scenario: haven runs mcpsim only when the worktree asks for it
      Given a worktree that has not said "haven up +mcp"
      Then mcpsim is off and no mcpsim lane is planned
      And the selection's description offers "mcp (haven up +mcp)"
      When the worktree says "haven up +mcp"
      Then a lane runs the bundled simulator as mcpsim on its port
      And a stack running mcpsim reads back as +mcp

    Scenario: haven points mcpsim at the stack's app with its key, project and local login
      When haven plans the mcpsim lane
      Then it names the stack, the app's URL as the endpoint, the seeded project API key, the local project and the sim's public URL
      And it names the local admin login for automatic approval
      But a stack with no seeded key names no API key

    Scenario: A dev build hosts mcpsim in the combined process
      Then `service combined` and `service mcpsim` both run it

    Scenario: An agent runs a scenario from the terminal and its exit code says whether it passed
      When the agent runs "haven sim mcp connect"
      Then it asks for the API key flow on both transports and waits for the run
      And a passed run exits zero and a failed one exits non-zero, with --json or without
      And --hold, --transport and --client reach the run, and refresh defaults to the OAuth flow
      And an unknown --flow or a bad --duration is refused
      And the wait covers the scenario's own length unless --timeout names another

    Scenario: An agent connects OAuth from the terminal
      When the agent runs "haven sim mcp oauth --mode interactive --open"
      Then it starts the connect with MCPSIM_COOKIE's session and without waiting
      And it opens the authorize URL and polls the run until it ends

    Scenario: An agent reads and manages runs from the terminal
      When the agent runs "haven sim mcp status", "list", "get latest", "grant", "forget", "stop <id>" or "clear"
      Then each calls its route on mcpsim's /_sim/api
      And "stop" with no id prints its usage, and an unknown verb is refused

  Rule: The console

    @integration
    Scenario: An operator reads a failed run in the console
      Given the sim lists a failed soak run
      When the console opens it
      Then it shows each check passed or failed, the load's latency and each step's status and error

    @integration
    Scenario: An operator starts a run from the console
      When the operator picks the both transport and starts connect
      Then the console posts the connect scenario on the API key flow for claude-code on both transports

    @integration
    Scenario: The console refuses a scenario setting that is not a whole number
      When the operator empties the soak's client count and starts soak
      Then the console says the count takes a whole number of 1 or more
      And it posts nothing

    @integration
    Scenario: The console disables a scenario the chosen flow cannot run
      Given the sim holds an OAuth grant
      Then refresh is disabled on the API key flow
      And it is enabled once the operator picks the OAuth flow

    Scenario: The console tells which scenarios a flow can run
      Then an OAuth-only scenario is blocked on the API key flow
      And any OAuth run is blocked while there is no grant
      And a scenario the flow offers is not blocked

    @integration
    Scenario: The console shows the approval link while an OAuth connect waits
      Given an OAuth connect is waiting for a person
      Then the console shows a banner linking to its authorize URL

    @integration
    Scenario: The setup view shows the target, the masked key and the grant
      Given the sim holds an OAuth grant
      Then the setup view shows the masked key and where it came from, the callback URL, the grant as connected with its client id
      And Forget is enabled

    @integration
    Scenario: The setup view offers an OAuth connect when there is no grant
      Given the sim holds no grant
      Then the setup view says there is no grant and offers Connect OAuth
      And Forget is disabled
