Feature: Connected agents
  As a developer who runs an agent
  I want to decorate the function that runs it and connect it to LangWatch
  So that simulations reach my running process without a public URL

  # A connected agent is an Agent row of type "connected". The SDK opens an
  # outbound WebSocket to /api/v1/agents/connect, registers the agents of the
  # process, and receives simulation turns over that socket. The platform
  # shows the agent Online while at least one instance is connected. The
  # same frames also travel over HTTP long polling for a process whose
  # network blocks WebSockets (the Rule at the end of this file).
  #
  # @see dev/docs/adr/128-connected-agents.md

  Background:
    Given a project with an API key that holds "scenarios:manage"

  # ---------------------------------------------------------------------------
  # Register and identity
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A register frame creates one row per agent name and environment
    Given an SDK process that registers "support-agent" in "production"
    When the register frame is accepted
    Then an agent row of type "connected" named "support-agent" exists in "production"
    And the registered reply carries the row id and the platform url

  @integration
  Scenario: A second register of the same identity updates the same row
    Given a connected agent row registered from a process
    When another process registers the same name and environment with new parameters
    Then no second row is created
    And the row carries the new parameters

  # Several instances of one agent normally start together, so two of them can
  # read no row and both go on to write one.
  @integration
  Scenario: Two instances registering together settle on one row
    Given two processes registering the same name and environment at once
    When both registrations are answered
    Then both carry the same agent row
    And the project holds one agent for that identity

  @integration
  Scenario: A reconnect of an unseen identity lists the row again
    Given a connected agent row last seen thirty one days ago
    When a process registers the same identity again
    Then the row is listed again

  # An agent has no manual way back, so a delete means "hidden until the
  # process connects again" rather than gone.
  @integration
  Scenario: A reconnect of an archived identity restores the row
    Given a connected agent row that was archived by hand
    When a process registers the same identity again
    Then the same row is active again

  @unit
  Scenario: The environment is sanitized before it becomes part of the identity
    Given a register frame naming the environment "Prod-EU 1"
    When the environment is sanitized
    Then the stored environment is "prod-eu-1"
    And an environment longer than 32 characters is cut to 32

  @unit
  Scenario: A development agent registered with a personal key belongs to its owner
    Given a personal API key of user "u_1"
    When a process registers an agent in "development"
    Then the identity key is "support-agent@development/user:u_1"
    And the row records "u_1" as the owner

  @unit
  Scenario: A development agent registered with a project key is scoped to its host
    Given a project key or a service key with no owner
    When a process on host "Rogerio's MacBook" registers an agent in "development"
    Then the identity key is "support-agent@development/host:rogerio-s-macbook"
    And the row records the host label and no owner

  @unit
  Scenario: An agent in any other environment is shared
    Given a personal API key of user "u_1"
    When a process registers an agent in "production"
    Then the identity key is "support-agent@production"
    And the row records no owner and no host label

  # ---------------------------------------------------------------------------
  # Owner-only refusal at scheduling
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A teammate cannot target another person's personal agent
    Given a personal development agent owned by user "u_1"
    When user "u_2" starts a run that targets it
    Then the run is refused with "agent_owner_only"
    And nothing is scheduled

  @integration
  Scenario: The owner can target their own personal agent
    Given a personal development agent owned by user "u_1"
    When user "u_1" starts a run that targets it
    Then the run is scheduled

  @integration
  Scenario: A legacy project key can never target a personal agent
    Given a personal development agent owned by user "u_1"
    When a run is started with no actor at all
    Then the run is refused with "agent_owner_only"

  @integration
  Scenario: A host-scoped development agent is runnable by the team
    Given a development agent scoped to a host and owned by no person
    When user "u_2" starts a run that targets it
    Then the run is scheduled

  @integration
  Scenario: A run can address a connected agent by name and environment
    Given a shared connected agent "support-agent" in "production"
    When a run targets "connected:support-agent@production"
    Then the target resolves to that agent's id

  @integration
  Scenario: A name and environment that match no agent are refused
    Given no connected agent named "ghost" in "production"
    When a run targets "connected:ghost@production"
    Then the run is refused as an invalid target reference

  # ---------------------------------------------------------------------------
  # Presence
  # ---------------------------------------------------------------------------

  @integration
  Scenario: An agent is online while one instance is connected
    Given an SDK process connected and registered
    When the agent is read
    Then its status is "online"
    And its instances list the process hostname and pid

  @integration
  Scenario: An agent goes offline after the presence TTL
    Given an instance whose last presence refresh is older than the TTL
    When the agent is read
    Then its status is "offline"

  @integration
  Scenario: The last seen time is written at most once a minute
    Given an agent whose last seen time was written a moment ago
    When presence is refreshed again inside the same minute
    Then the row is not written again
    And a refresh after the minute writes the row

  @integration
  Scenario: A connected agent unseen for thirty days is not listed
    Given a connected agent last seen thirty one days ago
    And a connected agent last seen yesterday
    When the agents of the project are listed
    Then only the second agent is listed

  @unit
  Scenario: A connected agent unseen for thirty days is refused as a run target
    Given a suite that targets a connected agent last seen thirty one days ago
    When the run is started
    Then the target is skipped the way an archived target is

  # ---------------------------------------------------------------------------
  # Dispatch
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A call reaches an instance connected to another app replica
    Given an instance connected to app replica A
    When a relay call is dispatched from app replica B
    Then the instance receives the call frame
    And the result the instance sends is returned to replica B

  # A call is delivered at most once. The platform places it again only when
  # it can prove the frame never reached an instance.
  @unit
  Scenario: A call the platform proves never arrived runs on another instance
    Given two live instances of one agent
    When the platform records that the call frame never left for the first instance
    Then the call is dispatched again to the other instance

  @unit
  Scenario: A delivered call whose instance goes away is never repeated
    Given two live instances of one agent
    And the call frame reached the first instance
    When that instance goes away before it acknowledges the call
    Then the call fails with "agent_disconnected"
    And no other instance receives it

  @unit
  Scenario: A call that was acknowledged is never repeated
    Given an instance that acknowledged a call
    When that instance goes away before it answers
    Then the call fails with "agent_disconnected"
    And no other instance receives it

  @unit
  Scenario: A call the store cannot write gives the instance slot back
    Given one live instance advertising a concurrency of one
    When the store refuses the write of the call
    Then the call fails
    And the next call to that agent still reaches the instance

  @unit
  Scenario: A call to an agent with no live instance is refused after the first-turn grace
    Given an agent with no live instance
    When a call is dispatched
    Then the dispatcher waits up to the first-turn grace for an instance
    And the call fails with "agent_offline"

  @unit
  Scenario: An instance that connects inside the grace receives the call
    Given an agent with no live instance
    When an instance registers inside the first-turn grace
    Then the call is dispatched to it

  @integration
  Scenario: Aborting the relay request cancels the call on the instance
    Given an instance that is working on a call
    When the relay request is aborted
    Then the instance receives a cancel frame for that call

  # The relay writes the handled code under "code". The older envelope repeats
  # it under "error", where a route that answers the canonical body writes the
  # status text instead. The code is what names the run's failure, so the
  # adapter reads the field that carries it.

  @unit
  Scenario: The child names a refused call by the code the relay wrote
    Given the relay refused a call with a body that carries the code and the status text
    When the child adapter raises the failure
    Then the failure carries the relay's code, not the status text
    And the run reads under the copy of that code

  @unit
  Scenario: A call that reaches its deadline fails with a typed timeout
    Given an instance that never answers
    When the call deadline passes
    Then the call fails with "agent_call_timeout"
    And the instance receives a cancel frame

  @unit
  Scenario: A call is refused when every instance is full
    Given one live instance advertising a concurrency of one
    And a call in flight on it
    When another call is dispatched
    Then the call fails with "agent_busy"
    And the refusal carries a retry delay

  @unit
  Scenario: An instance that refuses a call as busy keeps the busy code
    Given one live instance that answers with the busy code
    When a call is dispatched to it
    Then the call fails with "agent_busy"

  @unit
  Scenario: The instance with the most free slots is picked
    Given two live instances, one with a call in flight and one idle
    When a call is dispatched
    Then the idle instance receives it

  @unit
  Scenario: A sticky thread stays on its instance
    Given a sticky agent with two live instances
    And a thread already served by the first instance
    When a later turn of that thread is dispatched
    Then the first instance receives it

  @unit
  Scenario: A sticky thread fails when its instance is gone
    Given a sticky agent whose pinned instance is gone
    When a later turn of that thread is dispatched
    Then the call fails with "agent_instance_lost"

  @unit
  Scenario: A missed pong retires the instance
    Given a connected instance
    When the instance does not answer a ping inside the pong wait
    Then the socket is closed
    And the instance is no longer live

  # Every ping carries its own pong deadline, so a slow pong that still lands
  # inside that wait keeps the socket even when the next ping already went out.
  @integration
  Scenario: A pong that lands inside its own wait keeps the socket
    Given a connected instance whose pong arrives after the next ping went out
    When the pong lands inside the wait of its own ping
    Then the socket stays open
    And the instance is still live

  @integration
  Scenario: A socket that goes away during registration retires its instance
    Given a process whose socket closes while its registration is still running
    When the registration finishes
    Then the replica holds no connection for it
    And the instance is no longer live

  # ---------------------------------------------------------------------------
  # No inbound access
  # ---------------------------------------------------------------------------

  @unit
  Scenario: An instance never receives a call for an agent it did not register
    Given an instance that registered agent A only
    When a call for agent B is routed at that instance
    Then the call is not sent to it
    And the call fails for that instance with "agent_disconnected"

  @unit
  Scenario: A call envelope carries only the contract fields
    Given a relay call that carries a judgment request and platform metadata
    When the envelope is written for the instance
    Then its keys are exactly callId, agentId, threadId, messages, newMessages, params, session, traceparent, deadlineAt and run

  # ---------------------------------------------------------------------------
  # Payload caps
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A result above the result cap is refused
    Given an instance that answers with an output above the result cap
    When the result frame is checked
    Then it is refused with "agent_payload_too_large"

  @unit
  Scenario: A session above the session cap is refused
    Given an instance that answers with a session above the session cap
    When the result frame is checked
    Then it is refused with "agent_payload_too_large"

  @unit
  Scenario: The relay payload cap can be raised on a self-hosted deployment
    Given LANGWATCH_AGENT_RELAY_MAX_PAYLOAD_MB set to 128
    When the caps are read
    Then the envelope cap is 128 mebibytes
    And the socket frame cap is at least the envelope cap

  # ---------------------------------------------------------------------------
  # Credentials
  # ---------------------------------------------------------------------------

  @integration
  Scenario: An ingestion key cannot connect
    Given an ingestion key of the project
    When a process connects with it
    Then the connection is refused with "key_type_not_allowed"

  @integration
  Scenario: A Langy session key cannot connect
    Given a Langy session key of the project
    When a process connects with it
    Then the connection is refused with "key_type_not_allowed"

  @integration
  Scenario: A key without scenarios manage cannot connect
    Given a personal key that holds only "scenarios:view"
    When a process connects with it
    Then the connection is refused with "permission_denied"

  @integration
  Scenario: A key that reaches several projects must name one
    Given an organization key bound to several projects
    When a process connects without an X-Project-Id header
    Then the connection is refused with "project_required"
    And the refusal lists the projects the key can reach

  @integration
  Scenario: An invalid key cannot connect
    Given a token that names no key
    When a process connects with it
    Then the connection is refused with "api_key_invalid"

  @integration
  Scenario: The relay route needs scenarios create
    Given a personal key that holds only "scenarios:view"
    When it posts a relay call
    Then the call is refused as forbidden

  @integration
  Scenario: The relay route refuses an agent of another project
    Given a connected agent of another project
    When the project key posts a relay call to it
    Then the call is refused as not found

  @integration
  Scenario: The relay route refuses a personal agent of another person
    Given a personal development agent owned by user "u_1"
    When the personal key of user "u_2" posts a relay call to it
    Then the call is refused with "agent_owner_only"
    And nothing is dispatched

  @integration
  Scenario: The relay route lets the project key call a personal agent
    Given a personal development agent owned by user "u_1"
    And the owner gate already ran when the run was scheduled
    When the project key posts a relay call to it, the way the scenario child does
    Then the call reaches the dispatcher

  @unit
  Scenario: Connect is refused without Redis on a deployment with several replicas
    Given no Redis and LANGWATCH_APP_REPLICAS set to 3
    When a process connects
    Then the connection is refused with "replica_count_unsupported"

  # ---------------------------------------------------------------------------
  # Session echo
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The session an agent returns is echoed on the next turn of the thread
    Given an agent that answered the first turn of a thread with a session
    When the next turn of the same thread is sent
    Then the call carries that session
    And a turn of another thread carries no session

  # ---------------------------------------------------------------------------
  # Remote-trace judging
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A connected target is judged from its remote traces
    Given a run whose target is a connected agent
    When the run configuration is built
    Then remote traces are fetched the way they are for an http target

  # ---------------------------------------------------------------------------
  # Parameters declared by the agent
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A JSON Schema object becomes parameter definitions
    Given a schema with a string "model" with an enum, a number "temperature" with a default and a boolean "verbose"
    When the schema is normalized
    Then "model" is a string with the enum as its options
    And "temperature" is a number with its default
    And "verbose" is a boolean
    And a property listed as required is marked required

  @unit
  Scenario: An unsupported property type is downgraded to text with a note
    Given a schema with an "object" property
    When the schema is normalized
    Then the property is a string
    And the notes say the type was downgraded

  @unit
  Scenario: A parameter name outside the grammar is refused
    Given a schema with a property named "my-model"
    When the schema is normalized
    Then the normalization fails with "agent_parameter_invalid"

  @unit
  Scenario: More than twenty parameters are refused
    Given a schema with twenty one properties
    When the schema is normalized
    Then the normalization fails with "agent_parameter_invalid"

  @unit
  Scenario: More than fifty options are cut to fifty with a note
    Given a schema with an enum of sixty values
    When the schema is normalized
    Then the options list holds fifty values
    And the notes say the list was cut

  @unit
  Scenario: A turn field name is never a parameter
    Given a schema with a property named "messages"
    When the schema is normalized
    Then the normalization fails with "agent_parameter_invalid"

  @unit
  Scenario: A value outside a closed option list is refused before scheduling
    Given a target agent declaring "model" with the options "gpt-5-mini" and "gpt-5"
    When a run supplies "model" as "gpt-4o"
    Then the run is refused with "scenario_parameter_option_invalid"
    And the refusal names the options

  @unit
  Scenario: A required parameter with no value is refused before scheduling
    Given a target agent declaring "plan" as required with no default
    When a run supplies no value for "plan"
    Then the run is refused with "scenario_parameter_required"
    And the refusal names "plan"

  @unit
  Scenario: Unknown parameter names are checked per target against its agent
    Given a scenario declaring "tenant" and a target agent declaring "model"
    When a run supplies "model" for that target
    Then the run is accepted
    And a run supplying "region" is refused with "scenario_parameter_unknown"

  @unit
  Scenario: Scenario defaults win over agent defaults
    Given a scenario declaring "model" with the default "gpt-5" and an agent declaring "model" with the default "gpt-5-mini"
    When the declared defaults are read
    Then "model" defaults to "gpt-5"

  @unit
  Scenario: A target label carries the environment and the owner
    Given a connected agent "support-agent" in "production"
    And a personal one in "development" owned by "Rogerio"
    When the target labels are built
    Then the first reads "support-agent · production"
    And the second reads "support-agent · development (Rogerio)"

  # ---------------------------------------------------------------------------
  # Protocol
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Every frame carries the protocol version
    Given a register frame without a protocol field
    When the frame is parsed
    Then it is refused

  @unit
  Scenario: A result frame carries either an output or an error
    Given a result frame with both an output and an error
    When the frame is parsed
    Then it is refused

  @integration
  Scenario: A connected agent cannot be created by hand
    Given the REST agents API
    When a caller creates an agent of type "connected"
    Then the request is refused with "agent_register_only"

  @integration
  Scenario: An archived connected agent is still registered from code
    Given a connected agent row that was archived by hand
    When a caller renames it
    Then the request is refused with "agent_register_only"
    And the row keeps the name the process registered

  @integration
  Scenario: A connected agent cannot be copied
    Given a registered connected agent
    When a caller copies it
    Then the copy is refused with "agent_register_only"
    And no copied row is written

  @integration
  Scenario: A connected agent can be archived, and nothing else edited
    Given a registered connected agent
    When a caller archives it through the REST agents API
    Then the row is archived
    And an update of its configuration is refused with "agent_register_only"
    And an update that changes the type is refused with "agent_register_only"

  # ---------------------------------------------------------------------------
  # HTTP long-poll transport
  # ---------------------------------------------------------------------------

  Rule: The same frames travel over HTTP long polling

    # POST /api/v1/agents/connect/register takes the register frame and answers
    # with the registered frame and an instance token. GET
    # /api/v1/agents/connect/poll waits up to the poll wait for the next call and
    # cancel frames of that instance and refreshes its presence. POST
    # /api/v1/agents/connect/frames takes ack, result and deregister frames. The
    # session logic behind both transports is the same.

    @integration
    Scenario: A register over HTTP creates the rows and answers with an instance token
      Given an SDK process whose network blocks WebSockets
      When it posts a register frame to the register route with the API key
      Then an agent row of type "connected" exists for each agent of the frame
      And the answer carries the registered frame and an instance token

    @integration
    Scenario: The HTTP transport refuses the same credentials as the socket
      Given a personal key that holds only "scenarios:view"
      When it posts a register frame to the register route
      Then the answer is a refused frame with "permission_denied"
      And an ingestion key is refused with "key_type_not_allowed"

    @integration
    Scenario: A poll delivers a parked call once
      Given an instance registered over HTTP that is not polling
      When a call is dispatched to it
      And the instance polls
      Then the poll answers with the call frame
      And a second poll does not answer with the same call

    @integration
    Scenario: A poll refreshes presence
      Given an instance registered over HTTP
      When the instance polls
      Then the instance is live for its agent
      And a read after the presence TTL with no poll in between finds it offline

    @integration
    Scenario: A result posted over HTTP answers the dispatcher
      Given an instance that received a call by poll
      When it posts an ack frame and a result frame to the frames route
      Then the dispatcher returns the output of the result

    @integration
    Scenario: A cancel reaches a polling instance
      Given an instance that received a call by poll and acknowledged it
      When the relay request is aborted
      Then the next poll answers with a cancel frame for that call

    @integration
    Scenario: A deregister posted over HTTP retires the instance at once
      Given an instance registered over HTTP
      When it posts a deregister frame to the frames route
      Then the instance is no longer live
      And a poll with its instance token is answered with "agent_session_unknown"

    @integration
    Scenario: A poll with an unknown instance token asks the process to register again
      Given an instance token the platform does not know
      When a poll is made with it
      Then the answer is "agent_session_unknown" with status 410

    @integration
    Scenario: A process that stops polling goes offline after the presence TTL
      Given an instance registered over HTTP whose last poll is older than the presence TTL
      When a call is dispatched to its agent
      Then the call fails with "agent_offline"

    @unit
    Scenario: A poll with nothing pending answers empty after the poll wait
      Given an instance registered over HTTP and no pending call
      When the instance polls
      Then the poll answers with no frame once the poll wait passes

    @unit
    Scenario: An HTTP register is refused without Redis on a deployment with several replicas
      Given no Redis and LANGWATCH_APP_REPLICAS set to 3
      When a process posts a register frame
      Then the answer is a refused frame with "replica_count_unsupported"

    @integration
    Scenario: A frames body the endpoint does not take is refused as a protocol frame
      Given an instance registered over HTTP
      When it posts a body that carries no ack, result or deregister frame
      Then the answer is a refused frame with "protocol_invalid"

    @integration
    Scenario: A frames body above the cap names the limit alone
      Given an instance registered over HTTP
      When it posts a body above the frame cap
      Then it is refused with "agent_payload_too_large"
      And the message names the limit and no measured size
