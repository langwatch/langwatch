@cli @observability
Feature: Ollama instrumentation through the LangWatch CLI
  As a developer running models locally with Ollama
  I want to prefix my ollama command with langwatch
  So that every prompt, completion and token count from that session lands in LangWatch

  # Ollama exposes no telemetry configuration: there is no environment variable
  # that makes the server emit OpenTelemetry, and the CLI talks to the server
  # over HTTP. So the only place a prompt and its completion are both visible is
  # the wire between them. `langwatch ollama` starts a loopback proxy in front
  # of the configured Ollama server, points the child's OLLAMA_HOST at it, and
  # reports what passes through. The proxy is a forwarder first: an unrecognised
  # request reaches the server byte for byte and its answer reaches the caller
  # byte for byte, whether or not anything is reported.

  Background:
    Given the `langwatch` CLI is available
    And an Ollama server is running at the address OLLAMA_HOST names

  Rule: The session is captured without changing what the user sees

    @integration
    Scenario: A chat call is reported as one LangWatch call
      Given a captured session
      When a chat request is answered by the server
      Then LangWatch receives one model call
      And it carries the conversation that was sent and the reply that came back
      And it names the model, the provider Ollama, and the tokens the server counted

    @integration
    Scenario: A streamed reply reaches the caller as it arrives
      Given a captured session
      When a chat request is answered one chunk at a time
      Then the caller receives each chunk as the server sends it
      And the reported reply is the whole assembled answer

    @integration
    Scenario: A completion call is reported with its prompt and its answer
      Given a captured session
      When a completion request is answered by the server
      Then LangWatch receives one model call carrying that prompt and that answer

    @integration
    Scenario: A call made through the OpenAI-compatible endpoint is reported the same way
      Given a captured session
      When a chat request is sent to the OpenAI-compatible endpoint
      Then LangWatch receives one model call carrying the conversation and the reply

    @integration
    Scenario: A request the proxy does not report still reaches the server untouched
      Given a captured session
      When the model list is requested
      Then the server's own answer is returned unchanged
      And LangWatch receives no model call for it

    @integration
    Scenario: A server error is returned to the caller and reported as a failed call
      Given a captured session
      When the server rejects a chat request
      Then the caller receives the server's status and body
      And the reported call is marked failed

    @integration
    Scenario: A session with no model calls reports nothing
      Given a captured session
      When the session ends without any request
      Then LangWatch receives nothing

  Rule: The wrapped command behaves like the command it wraps

    @unit
    Scenario: Arguments are forwarded in the order they were written
      When I run "langwatch ollama run llama3 --verbose"
      Then `ollama` is started with "run llama3 --verbose"

    @unit
    Scenario: The exit code is the wrapped command's own
      Given the wrapped command exits with a failure code
      Then `langwatch ollama` exits with that same code

    @unit
    Scenario: A missing ollama binary is reported as a missing install
      Given `ollama` is not on the PATH
      When I run "langwatch ollama run llama3"
      Then the error says ollama is not installed and where to get it

    @unit
    Scenario: Starting the server through the wrapper is refused
      When I run "langwatch ollama serve"
      Then the command is refused before anything starts
      And the message explains the server would be told to listen on the proxy's own address
      And it says to run "ollama serve" directly and wrap the commands that talk to it

  Rule: The server the user configured is the server that answers

    @unit
    Scenario: The proxy forwards to the address OLLAMA_HOST names
      Given OLLAMA_HOST is "http://127.0.0.1:11434"
      Then requests are forwarded to that address

    @unit
    Scenario: An OLLAMA_HOST written without a scheme is understood
      Given OLLAMA_HOST is "127.0.0.1:11434"
      Then requests are forwarded to "http://127.0.0.1:11434"

    @unit
    Scenario: With OLLAMA_HOST unset the default local server is used
      Given OLLAMA_HOST is not set
      Then requests are forwarded to "http://127.0.0.1:11434"

    @integration
    Scenario: An unreachable server is named before the command starts
      Given no Ollama server is listening at the configured address
      When I run "langwatch ollama run llama3"
      Then a warning names the address that did not answer
      And the command still runs, so ollama reports the failure in its own words

  Rule: Where the calls land follows the scope the device already has

    @unit
    Scenario: A pinned project key sends the session to that project
      Given a project ingest key is pinned for ollama
      Then the calls are reported with that key, to that project's instance

    @unit
    Scenario: A pasted ingest key in the environment is used as-is
      Given no project is pinned and LANGWATCH_INGEST_KEY is set
      Then the calls are reported with that key

    @unit
    Scenario: Otherwise the signed-in personal workspace receives the session
      Given no project is pinned and no ingest key is in the environment
      And the device is signed in
      Then the calls are reported to the personal workspace

    @unit
    Scenario: Without a scope the command says what to do and runs anyway
      Given no project is pinned, no ingest key is in the environment, and the device is not signed in
      When I run "langwatch ollama run llama3"
      Then the message says to sign in or pass an ingest key
      And ollama still runs, uncaptured
