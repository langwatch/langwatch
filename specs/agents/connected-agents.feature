Feature: Connected agents
  As a developer who runs an agent
  I want to decorate the function that runs it and connect it to LangWatch
  So that simulations reach my running process without a public URL

  # A connected agent is an Agent row of type "connected". The SDK opens an
  # outbound WebSocket to /api/agents/connect, registers the agents of the
  # process, and receives simulation turns over that socket. The platform
  # shows the agent Online while at least one instance is connected.
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
    When another process registers the same name and environment with a new description
    Then no second row is created
    And the row carries the new description

  @integration
  Scenario: A reconnect of an unseen identity lists the row again
    Given a connected agent row last seen thirty one days ago
    When a process registers the same identity again
    Then the row is listed again

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

  @unit
  Scenario: A call is retried on another instance only before it is acknowledged
    Given two live instances of one agent
    When the first instance goes away before it acknowledges the call
    Then the call is dispatched again to the other instance

  @unit
  Scenario: A call that was acknowledged is never repeated
    Given an instance that acknowledged a call
    When that instance goes away before it answers
    Then the call fails with "agent_disconnected"
    And no other instance receives it

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
  Scenario: A connected agent can be archived and its description edited
    Given a registered connected agent
    When a caller archives it through the REST agents API
    Then the row is archived
    And an update that only edits the description is accepted
    And an update that changes the type is refused with "agent_register_only"
