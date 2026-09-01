Feature: Python SDK connect_agent decorator
  As a developer who runs an agent in Python
  I want to decorate the function that runs my agent
  So that LangWatch can send simulation turns to the process I already run

  Background: one decorator, one connection.
    `langwatch.connect_agent(name, ...)` wraps the function that answers one
    conversation turn. The decorator reads the signature once, builds the run
    parameter schema from it, registers the function in a process-wide
    registry and starts one shared WebSocket connection per process, lazily.
    The platform sends the same TURN FIELDS on every call: `messages`,
    `new_messages`, `thread_id`, `session` and `trace_id`. Every other
    parameter of the function is a RUN PARAMETER. The wrapped function stays
    directly callable with its own signature. See ADR-128.

  # --- Registration and lifecycle ---

  @unit
  Scenario: The decorator registers the function and keeps it callable
    Given a function decorated with connect_agent
    When the module that declares it is imported
    Then the function is in the process-wide agent registry under its name
    And calling the function directly runs the original code with the same signature

  @unit
  Scenario: Nothing happens without an API key
    Given no API key in the environment and none in the SDK state
    When a function is decorated with connect_agent
    Then no connection is started
    And exactly one warning line says the agent was not connected and to set LANGWATCH_API_KEY
    And the function stays callable
    And the registry still holds the agent so a later serve() can connect it

  @unit
  Scenario: A refused registration warns once, names the fix and disables the client
    Given the platform answers refused with one of the codes below
    Then exactly one warning line says the agent was not connected and names the fix
    And the client stops reconnecting
    And the function stays callable
      | code                 | fix                                                        |
      | project_required     | lists meta.projects and says to set LANGWATCH_PROJECT_ID   |
      | api_key_invalid      | says to check LANGWATCH_API_KEY                            |
      | key_type_not_allowed | says to use a project or personal API key                  |
      | permission_denied    | names the scenarios:manage permission                      |
      | parameters_invalid   | prints the server message                                  |
      | environment_invalid  | prints the server message                                  |

  @unit
  Scenario: An unreachable endpoint warns once and keeps reconnecting silently
    Given an endpoint that does not answer or a hostname that does not resolve
    When the client starts
    Then one warning line names the endpoint and says it keeps retrying
    And later attempts are silent until the state changes
    And the warning repeats at most once per five minutes

  @unit
  Scenario: A missing websockets package warns and disables the connection
    Given the websockets package cannot be imported
    When a function is decorated with connect_agent
    Then one warning line says to install websockets
    And the function stays callable

  @unit
  Scenario: Decoration never raises into the application
    Given the client fails to start for any reason
    When a function is decorated with connect_agent
    Then decoration returns the callable function
    And the connection attempt runs on the daemon thread, not at import

  @unit
  Scenario: The connection is enabled by default and disabled on CI
    Given no enabled argument
    Then the connection is enabled when CI is not set
    And the connection is disabled when CI is truthy

  @unit
  Scenario: LANGWATCH_AGENT_CONNECT=0 disables the connection
    Given LANGWATCH_AGENT_CONNECT set to "0" or "false"
    When a function is decorated with connect_agent, even with enabled=True
    Then no connection is started

  @unit
  Scenario: One connection carries every agent of the process
    Given two functions decorated with connect_agent
    When the client connects
    Then one register frame carries both agents

  @unit
  Scenario: serve() blocks until the process is interrupted
    Given a decorated function and a started client
    When serve() runs
    Then it blocks the calling thread
    And a KeyboardInterrupt makes it deregister and return

  @unit
  Scenario: A generator function is refused at decoration
    When a generator or async generator function is decorated with connect_agent
    Then decoration fails with a TypeError that says streaming is not supported

  # --- Turn fields ---

  @unit
  Scenario: Turn fields are passed by declared name only
    Given a function that declares messages and thread_id
    When a call arrives with every turn field
    Then the function receives messages and thread_id
    And it never receives an unexpected keyword argument

  @unit
  Scenario: A function with **kwargs receives every turn field
    Given a function that declares **kwargs
    When a call arrives
    Then kwargs holds messages, new_messages, thread_id, session and trace_id

  @unit
  Scenario: A first parameter annotated AgentCall receives one object
    Given a function whose first parameter is annotated langwatch.AgentCall
    When a call arrives
    Then the function receives one AgentCall with every turn field and the parameters

  @unit
  Scenario: The wrapped function is duck-typed for the scenario library
    Given a decorated function
    When the scenario library calls .call(input) with messages, new_messages and thread_id
    Then the function runs with those turn fields and the reply is returned

  # --- Run parameters from the signature ---

  @unit
  Scenario: Scalar annotations become typed parameters
    Given parameters annotated str, int, float and bool with defaults
    Then the schema declares string, integer, number and boolean properties with those defaults

  @unit
  Scenario: Literal and Enum annotations become a closed option list
    Given a parameter annotated Literal["a", "b"] and one annotated with an Enum
    Then each property carries an enum with the options

  @unit
  Scenario: Annotated with Param adds description and options
    Given a parameter annotated Annotated[str, Param(description=..., options=[...])]
    Then the property carries the description and the enum
    And an agent never declares a secret parameter, secrets stay scenario-declared

  @unit
  Scenario: Optional annotations are typed by their inner type and never required
    Given a parameter annotated Optional[int] = None
    Then the property has type integer and the parameter is not required

  @unit
  Scenario: A parameter with no default is required
    Given a parameter with no default that is not a turn field
    Then the schema lists it under required

  @unit
  Scenario: An unsupported annotation falls back to the pydantic schema
    Given a parameter annotated with a pydantic model or a list
    Then the property is the pydantic JSON schema of that annotation

  @unit
  Scenario: Turn field names are never run parameters
    Given a function that declares messages, thread_id and session
    Then the schema has no property with those names

  @unit
  Scenario: An explicit parameters argument overrides reflection
    Given connect_agent(parameters={...}) with a definition map
    Then the schema is built from the map and not from the signature

  @unit
  Scenario: A parameter the platform did not send takes its default
    Given a parameter plan="free"
    When a call arrives without plan
    Then the function receives plan="free"

  @unit
  Scenario: A required parameter the run did not supply is refused before the call
    Given a parameter with no default
    When a call arrives without it
    Then the function does not run
    And the result carries error code agent_parameter_invalid with the parameter name

  @unit
  Scenario: An invalid parameter value is refused before the call
    Given a parameter annotated int
    When a call arrives with a value that is not an integer
    Then the function does not run
    And the result carries error code agent_parameter_invalid

  @unit
  Scenario: A value outside a closed option list is refused before the call
    Given a parameter annotated Literal["gpt-5", "gpt-5-mini"]
    When a call arrives with model="gpt-3"
    Then the result carries error code agent_parameter_invalid

  # --- Return shapes ---

  @unit
  Scenario: A string return is the output
    When the function returns a string
    Then the result output is that string

  @unit
  Scenario: A message or a list of messages is the output
    When the function returns one message dict or a list of message dicts
    Then the result output is that message or that list

  @unit
  Scenario: AgentReply carries output and session
    When the function returns AgentReply(output, session=...)
    Then the result frame carries output and session

  @unit
  Scenario: The session is echoed on the next turn of the same thread
    Given a function that declares session
    When a call arrives with the session the function returned before
    Then the function receives that session value

  # --- Dispatch ---

  @unit
  Scenario: A sync function runs in a worker thread
    Given a sync decorated function
    When a call arrives
    Then the function runs on a thread that is not the connection thread

  @unit
  Scenario: An async function runs on the connection loop
    Given an async decorated function
    When a call arrives
    Then the coroutine is awaited on the connection loop

  # --- Environment and identity ---

  @unit
  Scenario: The environment is resolved in a fixed order
    Then the explicit argument wins
    And LANGWATCH_AGENT_ENVIRONMENT comes next
    And APP_ENV, ENVIRONMENT and NODE_ENV follow in that order
    And the default is development

  @unit
  Scenario: The environment is sanitized
    Given an environment value with spaces, uppercase letters and symbols
    Then the resolved environment is lowercase with dashes and at most 32 characters

  @unit
  Scenario: The instance identity carries hostname, username, pid and label
    When the client builds its instance identity
    Then it carries a sanitized hostname, the username, the pid, a start time and the label
    And a hostname or username lookup that fails leaves the field empty

  @unit
  Scenario: The instance label comes from the argument or the environment
    Then the explicit instance_label wins
    And LANGWATCH_AGENT_INSTANCE_LABEL comes next
    And there is no label otherwise

  @unit
  Scenario: The socket URL is derived from the configured endpoint
    Given the endpoint https://app.langwatch.ai
    Then the socket URL is wss://app.langwatch.ai/api/v1/agents/connect
    And http://localhost:5560 becomes ws://localhost:5560/api/v1/agents/connect

  # Every connection carries the API key in an Authorization header.
  @unit
  Scenario: The API key never travels over a cleartext connection
    Given an endpoint that is not encrypted and is not loopback
    When the client builds its connection URL
    Then it refuses, naming https as what the endpoint needs
    And a loopback endpoint is still allowed, since it never leaves the machine

  @unit
  Scenario: The connection carries the API key and the SDK version
    When the client connects
    Then the request carries Authorization Bearer with the API key
    And User-Agent langwatch-python with the SDK version
    And X-Project-Id when a project id is configured
    And the API key never appears in the URL

  # --- Protocol ---

  @unit
  Scenario: Register sends the SDK, the instance and the agents
    When the client connects
    Then the first frame is register with protocol 1
    And it carries sdk, instance and agents with their parameter schema

  @unit
  Scenario: A call is acknowledged before the function runs
    When a call frame arrives
    Then an ack frame with the call id is sent before the function starts

  @unit
  Scenario: The result frame carries the call id and the output
    When the function returns
    Then a result frame with the call id and the output is sent

  @unit
  Scenario: A function that raises answers agent_call_failed
    When the function raises
    Then a result frame with error code agent_call_failed is sent
    And the connection stays open

  @unit
  Scenario: The deadline of a call is read as epoch milliseconds
    Given a call frame whose deadlineAt is an epoch in milliseconds
    When the SDK computes the seconds left
    Then the remaining time is measured from now
    And an ISO 8601 deadline is still accepted

  @unit
  Scenario: A call past its deadline answers agent_call_timeout
    Given a function that runs longer than the deadline
    Then a result frame with error code agent_call_timeout is sent

  @unit
  Scenario: A cancel frame stops the running call
    Given a call in flight
    When a cancel frame with its call id arrives
    Then the function is cancelled and no result is sent for it

  @unit
  Scenario: A call past the concurrency limit answers agent_busy
    Given concurrency=1 and one call in flight
    When a second call arrives
    Then the second call answers error code agent_busy at once

  @unit
  Scenario: The traceparent of the envelope is adopted before the call
    Given a call frame with a traceparent
    When the function starts a span
    Then the span belongs to the trace of the traceparent
    And its parent is the span of the traceparent

  @unit
  Scenario: The client reconnects with backoff after the server drops
    Given a connected client
    When the server closes the socket
    Then the client connects again and sends register
    And a close with code 1012 reconnects at once

  @unit
  Scenario: In-flight call ids are announced on re-register
    Given a call in flight when the socket drops
    When the client registers again
    Then the register frame lists that call id under inFlightCallIds

  @unit
  Scenario: Deregister is sent on shutdown
    Given a connected client
    When the process stops through SIGINT, SIGTERM or exit
    Then a deregister frame is sent before the socket closes

  @unit
  Scenario: A fork restarts the client in the child
    Given a started client
    When the process forks
    Then the child gets a new instance id and a new connection thread

  # --- Transport ---

  @unit
  Scenario: The transport option selects HTTP long polling
    Given connect_agent(transport="http")
    When the client starts
    Then it posts the register frame to /api/v1/agents/connect/register with the API key
    And it polls /api/v1/agents/connect/poll with the instance token
    And a call answered by the poll is acked and answered by a POST to /api/v1/agents/connect/frames

  @unit
  Scenario: LANGWATCH_AGENT_TRANSPORT selects the transport
    Given LANGWATCH_AGENT_TRANSPORT set to "http" and no transport argument
    When the client starts
    Then it registers over HTTP and opens no WebSocket

  @unit
  Scenario: A refused WebSocket upgrade falls back to HTTP with one warning
    Given the default transport
    And a proxy that answers the WebSocket upgrade with an HTTP status
    When the client starts
    Then one warning line names the status and says the HTTP transport is used
    And the client registers over HTTP at once

  @unit
  Scenario: A poll that answers session unknown registers again
    Given a client registered over HTTP with a call in flight
    When a poll is answered with status 410
    Then the client posts a new register frame that lists the in-flight call id

  @unit
  Scenario: Deregister is posted on shutdown over HTTP
    Given a client registered over HTTP
    When the client stops
    Then a deregister frame is posted to the frames route before the thread ends
