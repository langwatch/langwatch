@unit
Feature: connectAgent turns a function into a simulation target
  As a developer with an agent written in TypeScript
  I want to wrap the function that runs it with connectAgent from langwatch/agent
  So that LangWatch can run simulations against it with no public URL

  # The wrapper registers the function in a process-wide registry, opens one
  # outbound WebSocket per process to /api/v1/agents/connect, sends a register
  # frame with the instance identity and the parameter schema, and answers
  # call frames by running the function. See dev/docs/adr/128-connected-agents.md.

  Rule: The connection starts on definition, once per process

    Scenario: Defining an agent starts one shared socket on the next tick
      Given an API key is configured
      When two agents are defined in the same process
      Then one register frame reaches the platform
      And it lists both agents

    Scenario: An agent defined before the registration is answered still reaches the platform
      Given an agent was defined and its register frame is not answered yet
      When a second agent is defined
      Then the client opens a new socket
      And the register frame on it lists both agents

    Scenario: An agent defined after the registration is answered still reaches the platform
      Given an agent was defined and its register frame is answered
      When a second agent is defined
      Then the client opens a new socket
      And the register frame on it lists both agents

    Scenario: An agent that disconnects leaves the platform with the remaining list
      Given two agents were defined and their register frame is answered
      When one of them disconnects
      Then the client opens a new socket
      And the register frame on it lists the agent that stayed

    Scenario: Nothing happens without an API key
      Given no API key is configured
      When an agent is defined
      Then no socket is opened
      And one warning says why

    Scenario: The connection is disabled on CI by default
      Given CI is set to a truthy value
      When an agent is defined without an explicit enabled option
      Then no socket is opened

    Scenario: LANGWATCH_AGENT_CONNECT=0 disables the connection
      Given LANGWATCH_AGENT_CONNECT is "0"
      When an agent is defined with enabled true
      Then no socket is opened

    Scenario: The register frame carries the instance identity and the parameter schema
      When an agent is defined with parameters
      Then the register frame carries protocol 1, the SDK name and version
      And the instance id, hostname, username, pid and start time
      And the agent name, environment, concurrency and timeout
      And the parameters as a JSON Schema object

  Rule: The handler receives the turn fields and returns one of four shapes

    Scenario: A call frame reaches the handler as one object
      Given a connected agent
      When the platform sends a call frame
      Then the handler receives messages, newMessages, threadId, session, params and traceId
      And an ack frame is sent before the handler runs
      And a result frame carries the handler output

    Scenario: A string reply is the output
      When the handler returns a string
      Then the result frame output is that string

    Scenario: A message reply is the output
      When the handler returns one message
      Then the result frame output is that message

    Scenario: A list of messages is the output
      When the handler returns a list of messages
      Then the result frame output is that list

    Scenario: A reply with a session echoes the session
      When the handler returns an object with output and session
      Then the result frame carries both

    Scenario: A handler error becomes a call error
      When the handler throws
      Then the result frame carries the error code agent_call_failed and the message
      And the process keeps running

    Scenario: The wrapped function is directly callable
      Given an agent defined with a parameter that has a default
      When the wrapped function is called with messages only
      Then the handler runs with the default value
      And the reply is returned as output and session

  Rule: Parameters are declared with a schema library, a definition map or a JSON Schema

    Scenario: A zod schema types the handler params
      Given parameters declared as a zod object with model as an enum with a default, plan a string with a default and maxTools a number with a default
      Then params.model is the union of the enum values
      And params.plan is a string
      And params.maxTools is a number

    Scenario: A zod schema validates the values before the call
      Given parameters declared as a zod object with maxTools an integer
      When a call carries 2.5 for maxTools
      Then the call is refused with agent_parameter_invalid naming maxTools
      And the handler does not run

    Scenario: A zod schema fills its defaults and keeps undeclared values
      Given parameters declared as a zod object with plan defaulting to free
      When a call carries only a scenario-declared value tone
      Then the handler receives plan free and tone as sent

    Scenario: A definition map becomes a JSON Schema object
      Given parameters model with options and a default, plan with a default, and maxTools typed number
      When the schema is built
      Then model is a string with an enum, plan a string, maxTools a number
      And none of them is required

    Scenario: A parameter with no default is required
      Given a parameter declared with a description only
      When the schema is built
      Then the parameter is listed as required

    Scenario: A Standard JSON Schema object is read through its jsonSchema converter
      Given an object with "~standard".jsonSchema
      When the schema is built
      Then the converter output is used as the parameter schema

    Scenario: A plain JSON Schema is used as is
      Given an object with type object and properties
      When the schema is built
      Then it is the parameter schema

    Scenario: A schema object with no JSON Schema converter is refused
      Given a value that has no "~standard".jsonSchema and no properties, for example a zod 3 instance
      When the schema is built
      Then the definition is refused with a message naming the three accepted forms

    Scenario: The handler params are typed from the definition map
      Given parameters model with options, plan with a string default and maxTools typed number
      Then params.model is the union of the options
      And params.plan is a string
      And params.maxTools is a number

    Scenario: A missing parameter takes its default
      Given a parameter with a default
      When a call frame carries no value for it
      Then the handler receives the default

    Scenario: A required parameter the run did not supply is refused before the call
      Given a parameter with no default
      When a call frame carries no value for it
      Then the result frame carries the error code agent_parameter_invalid naming the parameter
      And the handler does not run

    Scenario: A value outside the options is refused before the call
      Given a parameter with options
      When a call frame carries a value that is not one of them
      Then the result frame carries the error code agent_parameter_invalid
      And the handler does not run

    Scenario: A number parameter reads a numeric string
      Given a parameter typed number
      When a call frame carries "7" for it
      Then the handler receives 7

  Rule: Environment and instance identity are resolved by the SDK

    Scenario: The environment is the explicit option first
      Given LANGWATCH_AGENT_ENVIRONMENT is "staging"
      When an agent is defined with environment "production"
      Then the register frame names production

    Scenario: The environment falls back through the environment variables
      Given LANGWATCH_AGENT_ENVIRONMENT, APP_ENV, ENVIRONMENT and NODE_ENV are unset
      When the environment is resolved
      Then it is development

    Scenario: LANGWATCH_AGENT_ENVIRONMENT wins over APP_ENV, ENVIRONMENT and NODE_ENV
      Given all four variables are set
      When the environment is resolved
      Then it is the value of LANGWATCH_AGENT_ENVIRONMENT

    Scenario: The environment is sanitized
      When the environment is "My Staging/Env"
      Then it becomes "my-staging-env"
      And a name longer than 32 characters is cut to 32

    Scenario: The hostname is sent as a host label
      Given os.hostname is "ACME-Laptop.home"
      When the instance identity is built
      Then the hostname is "acme-laptop"
      And a hostname longer than 24 characters is cut to 24

    Scenario: The instance identity is read defensively
      Given os.hostname throws
      When the instance identity is built
      Then the hostname is empty and the id, pid and start time are still set

    Scenario: The instance label comes from the option or LANGWATCH_AGENT_INSTANCE_LABEL
      Given LANGWATCH_AGENT_INSTANCE_LABEL is "blue"
      When an agent is defined without instanceLabel
      Then the register frame carries the label blue

    Scenario: The connect URL is derived from the endpoint
      When the endpoint is https://app.langwatch.ai
      Then the socket URL is wss://app.langwatch.ai/api/v1/agents/connect
      And http://localhost:5560 gives ws://localhost:5560/api/v1/agents/connect

    Scenario: The socket carries the API key, the project id and the SDK user agent
      Given LANGWATCH_PROJECT_ID is set
      When the socket opens
      Then the headers carry Authorization Bearer, X-Project-Id and User-Agent langwatch-typescript with the version

  Rule: The connection survives the platform and shuts down with the process

    Scenario: A refused frame stops the client
      When the platform answers register with refused
      Then the error is logged with its code
      And no reconnect is attempted

    Scenario: A closed socket reconnects with backoff and re-announces in-flight calls
      Given a connected agent with a call in progress
      When the platform closes the socket
      Then the client reconnects after a delay between one and thirty seconds
      And the new register frame lists the in-flight call id

    Scenario: A cancel frame drops the result of that call
      Given a call in progress
      When the platform sends cancel for it
      Then no result frame is sent for that call when the handler returns

    Scenario: A cancel frame frees the concurrency slot at once
      Given an agent with concurrency 1 and a call in progress
      When the platform sends cancel for that call
      Then a later call runs instead of being refused as busy

    Scenario: A handler that never returns frees its slot on the timeout
      Given an agent with concurrency 1 and a handler that never returns
      When the call timeout passes
      Then its result frame carries the error code agent_call_timeout
      And a later call runs instead of being refused as busy

    Scenario: A call beyond the concurrency limit is refused as busy
      Given an agent with concurrency 1 and a call in progress
      When a second call frame arrives
      Then its result frame carries the error code agent_busy
      And the first call completes

    Scenario: The concurrency slot is taken before the parameters are read
      Given an agent with concurrency 1
      When a second call frame arrives while the first call still reads its parameters
      Then the second result frame carries the error code agent_busy
      And the handler runs once

    Scenario: Disconnecting sends deregister and closes the socket
      Given a connected agent
      When disconnect is called
      Then a deregister frame is sent
      And the socket closes
      And no reconnect is attempted

    Scenario: SIGINT and SIGTERM send deregister
      Given a connected agent
      When the process receives SIGTERM
      Then a deregister frame is sent before the process exits

    Scenario: The socket keeps the event loop alive while connected
      Given a connected agent and nothing else pending
      Then the process does not exit until disconnect is called

  Rule: A failure on the LangWatch side never stops the application

    # Each of these produces exactly one warning through the SDK logger that
    # says the agent was not connected to LangWatch and names the fix. The
    # returned function stays callable and the application continues.

    Scenario: A missing API key is one warning that names LANGWATCH_API_KEY
      Given no API key is configured
      When two agents are defined
      Then one warning says the agent is not connected to LangWatch and to set LANGWATCH_API_KEY
      And both wrapped functions are still callable

    Scenario: A key that reaches several projects lists them and names LANGWATCH_PROJECT_ID
      When the platform refuses with project_required and the projects the key reaches
      Then one warning lists the project names and ids and says to set LANGWATCH_PROJECT_ID
      And no reconnect is attempted

    Scenario: An invalid key is one warning that names LANGWATCH_API_KEY
      When the platform refuses with api_key_invalid
      Then one warning says the key is not valid and names LANGWATCH_API_KEY
      And no reconnect is attempted

    Scenario: A key type that cannot connect agents is one warning that names the key types that can
      When the platform refuses with key_type_not_allowed
      Then one warning names a personal or project API key

    Scenario: A missing permission is one warning that names the permission
      When the platform refuses with permission_denied
      Then one warning names the scenarios:manage permission

    Scenario: A refused registration for parameters or environment prints the server message
      When the platform refuses with parameters_invalid or environment_invalid
      Then one warning carries the server message

    Scenario: An unreachable endpoint is one warning and silent retries
      Given the endpoint refuses the connection
      When the client retries several times
      Then one warning says the agent is not connected to LangWatch and names the endpoint
      And the retries produce no further warning within five minutes
      And a reconnect timer stays armed so a standalone script stays up

    Scenario: A connection that comes back is reported once
      Given the endpoint was unreachable and one warning was given
      When the connection is established
      Then one info line says the agent connected

    Scenario: No WebSocket implementation is one warning and the client gives up
      Given the ws package is not installed
      When an agent is defined
      Then one warning says to install ws
      And no reconnect timer is left armed

    Scenario: The API key travels only in the Authorization header
      When the socket opens
      Then the request URL carries no key
      And the Authorization header carries it

  Rule: The transport is WebSocket by default and HTTP long polling when asked or when the upgrade is refused

    Scenario: The transport option selects HTTP long polling
      Given an agent defined with transport "http"
      When the client connects
      Then the register frame is posted to /api/v1/agents/connect/register with the API key in the Authorization header
      And the client polls /api/v1/agents/connect/poll with the instance token
      And a call answered by the poll is acked and answered by a POST to /api/v1/agents/connect/frames

    Scenario: LANGWATCH_AGENT_TRANSPORT selects the transport
      Given LANGWATCH_AGENT_TRANSPORT is "http"
      When an agent is defined without a transport option
      Then the client registers over HTTP and opens no socket

    Scenario: A refused WebSocket upgrade falls back to HTTP with one warning
      Given a proxy that answers the WebSocket upgrade with an HTTP status
      When an agent is defined with the default transport
      Then one warning names the status and says the HTTP transport is used
      And the client registers over HTTP at once

    Scenario: A poll that answers session unknown registers again
      Given a client registered over HTTP with a call in progress
      When a poll is answered with status 410
      Then the client posts a new register frame that lists the in-flight call id

    Scenario: Disconnecting over HTTP posts deregister
      Given a client registered over HTTP
      When disconnect is called
      Then a deregister frame is posted to the frames route
      And no poll is made after that

    Scenario: A register answered with no instance token ends the connection
      Given a register answered with a registered frame and no instance token
      When the client reads the answer
      Then the connection ends and the client registers again

    Scenario: A poll answered with a status and a frame that is not a refusal ends the connection
      Given a poll answered with a status and a frame that is not a refusal
      When the client reads the answer
      Then the connection ends and the client registers again

    Scenario: A poll answered at once is followed by a floor before the next one
      Given a proxy that answers every poll at once with no frame
      When the client polls
      Then the polls are spaced by the poll floor instead of spinning

    Scenario: A stalled frames request does not hold the socket open
      Given a client registered over HTTP whose frames route never answers
      When an agent is added and the client closes the connection to register again
      Then the close gives the queued frames a deadline and reports itself anyway
      And the client posts a new register frame that lists the added agent

  Rule: The traceparent of a call is the parent context of the handler

    Scenario: The handler runs under the traceparent of the call
      Given a W3C propagator is registered
      When a call frame carries a traceparent
      Then the active span context inside the handler has that trace id
      And call.traceId is that trace id
