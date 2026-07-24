Feature: Scenario worker logs carry the parent's logger context
  As an SRE diagnosing a failing scenario run from CloudWatch Insights
  I need every log line emitted by the worker (parent + child + adapter)
  So I can grep one scenarioRunId and reconstruct the full lifecycle
  without reading multi-line stderr blobs.

  Background: tracking lw#3593. Three concrete gaps surfaced during a
  recent investigation:
    1. http-agent.adapter.ts had zero logging on either path.
    2. scenario-child-process.ts used console.error (unstructured).
    3. The parent's logger.child({ scenarioRunId, batchRunId, projectId })
       didn't cross the parent → child boundary.

  The fix: serialize the parent's context to env, rebuild the child's
  base logger from it, and replace console.error with structured logs.
  The HTTP adapter logs every call (success or failure) at info level.

  @unit
  Scenario: child process logger inherits the parent's context bindings
    Given the parent serializes context {projectId, batchRunId, scenarioRunId}
      into the LANGWATCH_LOG_CONTEXT env var
    When the child reads the env var
    Then createChildLogger returns a logger whose bindings include all 3 keys

  @unit
  Scenario: child process tolerates missing context env var
    Given LANGWATCH_LOG_CONTEXT is unset
    When the child requests its base logger
    Then a logger is returned without bindings and without throwing

  @unit
  Scenario: child process tolerates invalid context JSON
    Given LANGWATCH_LOG_CONTEXT contains malformed JSON
    When the child requests its base logger
    Then a logger is returned without bindings and a warning is emitted

  @unit
  Scenario: HTTP adapter logs successful calls with url, method, status, latency
    Given a SerializedHttpAgentAdapter pointed at a server that returns 200
    When the adapter executes a request
    Then the logger receives an "http call ok" info entry
      with fields {url, method, statusCode, durationMs}

  @unit
  Scenario: HTTP adapter logs non-2xx responses with body preview
    Given a SerializedHttpAgentAdapter pointed at a server that returns 503
      with response body "upstream busy"
    When the adapter executes a request
    Then the logger receives an "http call failed" warn entry
      with fields {url, method, statusCode, durationMs, responseBodyPreview}
      and the preview contains "upstream busy"

  @unit
  Scenario: HTTP adapter logs network failures with error class
    Given a SerializedHttpAgentAdapter where ssrfSafeFetch throws "ECONNREFUSED"
    When the adapter executes a request
    Then the logger receives an "http call failed" error entry
      with fields {url, method, errorClass}
      and errorClass equals "Error"
