Feature: A scenario turn runs on the project's own engine without the credential for it
  As a customer running a code or workflow agent in a simulation on SaaS
  I want my turn executed by my project's own engine
  So that one tenant's simulation cannot reach another tenant's engine

  Background:
    A code or workflow target's turn is executed by an adapter running in the
    scenario child process, which posts an execute_flow event to nlpgo's
    /studio/execute_sync.

    Self-hosted there is one engine and the child posts to it directly, at
    LANGWATCH_NLP_SERVICE, carrying the engine's internal secret.

    On SaaS each project has its OWN engine, an AWS Lambda. Invoking it needs
    LANGWATCH_NLP_LAMBDA_CONFIG, a static AWS key that may invoke ANY project's
    function and create new ones. That credential is the tenant boundary, so it
    cannot be in the child's environment allowlist. The child posts to the
    control plane instead, with the project key it already carries, and the
    control plane makes the invoke.

    The parent decides which of the two, at prefetch time, and carries the
    answer on the job: it is the only process that can see whether this
    deployment has per-project engines.

    # Bindings:
    #   platform/app/src/server/scenarios/execution/serialized-adapters/__tests__/execute-sync-transport.unit.test.ts
    #   platform/app/src/server/scenarios/execution/__tests__/resolve-execute-sync-route.unit.test.ts
    #   platform/app/src/server/scenarios/execution/serialized-adapters/__tests__/execute-sync-relay-errors.unit.test.ts
    #   platform/app/src/server/scenarios/execution/__tests__/child-environment-no-lambda-credential.unit.test.ts
    #   platform/app/src/server/routes/__tests__/scenario-execute-sync.integration.test.ts

  Rule: The parent chooses the route and the child obeys it

    @unit
    Scenario: A deployment with per-project engines relays
      Given the deployment is configured with per-project engines
      When the parent prepares a scenario run
      Then the run is routed through the control plane

    @unit
    Scenario: A deployment with one engine posts to it directly
      Given the deployment has no per-project engines
      When the parent prepares a scenario run
      Then the run is routed straight to the engine
      And the route names the engine the deployment already configured

    @regression @unit
    Scenario: A relayed turn does not leave the deployment
      Given the deployment is configured with per-project engines
      When the parent prepares a scenario run
      Then the route names the address the platform hands out as itself
      And it does not name the deployment's public hostname
      # The public hostname is served through a CDN, which ends a request the
      # origin has not answered within 100 seconds. A turn may run for ten
      # minutes, so routing it past the edge lets the edge set the ceiling.

    @unit
    Scenario: A job queued before the route existed still runs
      Given a job carrying no route
      When the child builds its transport
      Then it posts straight to the engine URL the job already carried
      # A deploy has to be able to drain its queue. Failing every in-flight
      # run would turn a routing change into an outage.

  Rule: The child never holds the credential that reaches another tenant

    @unit
    Scenario: The child's environment carries no AWS or per-project engine credential
      When a scenario child process is started
      Then its environment names no AWS credential
      And its environment does not carry the per-project engine configuration
      # The allowlist in child-environment.ts is the only route from the
      # operator's environment into the child, so this is the whole check.

    @unit
    Scenario: A relayed turn presents the project's own key
      Given a run routed through the control plane
      When the child sends a turn
      Then the request carries the project key as X-Auth-Token
      And it does not carry the engine's internal secret
      # The project key is already in the child, for the DSL's own api_key.
      # Nothing new is added to reach the relay.

    @unit
    Scenario: A direct turn presents the engine's internal secret
      Given a run routed straight to the engine
      When the child sends a turn
      Then the request carries the engine's internal secret
      And it does not carry the project key as a header

  Rule: The control plane binds the project from the credential

    @integration
    Scenario: The project comes from the key
      Given a project key for one project
      When a turn is relayed with that key
      Then the turn runs on that project's engine

    @integration
    Scenario: A body naming another project changes nothing
      Given a project key for one project
      And a body naming a different project
      When a turn is relayed with that key
      Then the turn still runs on the key's own project
      # Reading a project from the body is how a relay becomes a way to reach
      # someone else's engine.

    @integration
    Scenario: A turn with no credential is refused
      Given no credential
      When a turn is relayed
      Then it is refused as unauthenticated
      And no engine is reached

  Rule: The control plane answers what the engine answered

    @integration
    Scenario: A successful run passes through
      Given the engine answers a run with a result
      When a turn is relayed
      Then the caller reads the engine's status and body unchanged

    @integration
    Scenario: A rejected request passes through
      Given the engine rejects the request with a non-2xx and its error envelope
      When a turn is relayed
      Then the caller reads that same status and that same body
      # The adapter decides between a rejected request, a failed run and a
      # malformed body from the status and the body alone. Rewriting either
      # collapses them into one another.

    @integration
    Scenario: A failed run passes through as the 200 it is
      Given the engine answers 200 with a run whose status is error
      When a turn is relayed
      Then the caller reads a 200 and the engine's error envelope
      # This is the customer's Python failing. Reported as a transport error it
      # would read as an infrastructure fault; dropped, it would read as an
      # empty agent reply (lw#3439).

    @integration
    Scenario: The body reaches the engine unchanged
      Given a turn whose workflow carries an api_key, secrets and params
      When the turn is relayed
      Then the engine receives all three exactly as the adapter wrote them

    @integration
    Scenario: A relayed turn sends no causality depth
      When a turn is relayed
      Then the request to the engine carries no causality-depth header
      # The engine stamps the depth it is told on every span it emits, and the
      # trace pipeline skips dispatching evaluations at depth 1 or more. A
      # depth on a scenario run stops ON_MESSAGE monitors firing on the traces
      # that run produces.

    @integration
    Scenario: A large turn is accepted
      Given a turn whose workflow is several megabytes
      When the turn is relayed
      Then the control plane accepts it
      And the engine receives the whole body
      # The control plane has the database and the object store the child does
      # not, so it is also where an oversized invoke can be staged past the
      # 6 MiB Lambda cap.

  Rule: A stopped run stops the engine

    @integration
    Scenario: A caller that goes away cancels the invoke
      Given a relayed turn in flight
      When the caller's request is cancelled
      Then the invoke is cancelled
      And the run is not reported as an unhandled failure
      # Stopping a simulation kills the child, which closes the request. Left
      # uncancelled the engine would keep running with nothing waiting for it.

    @integration
    Scenario: A turn past the platform's ceiling is refused as a timeout
      Given a relayed turn that outlives the platform's maximum for one turn
      When the ceiling passes
      Then the caller is told the engine did not answer in time

  Rule: Every failure the adapters report survives the relay

    @unit
    Scenario Outline: A failure keeps its kind on the relayed route
      Given a run routed through the control plane
      When the turn fails with <failure>
      Then the adapter reports kind <kind> and source <source>

      Examples:
        | failure                            | kind      | source      |
        | a 200 whose run status is error    | execution | user_code   |
        | a non-2xx carrying an envelope     | http      | nlp_service |
        | a 2xx body that is not JSON        | parse     | nlp_service |
        | a connection that is never made    | fetch     | network     |
        | its own deadline passing           | timeout   | timeout     |

  Rule: A caller already inside the control plane does not relay to itself

    @unit
    Scenario: The agent-test turn reaches the engine directly
      Given an agent test, which runs in the control plane rather than a child
      When it sends its one turn
      Then it reaches the engine the way the control plane always does
      And it does not post to the relay route
