Feature: Traffic attribution on request logs

  Operators need to answer "which tenants send the most traffic, and through
  which channel" from the logs alone. The logging context already stamps the
  tenant onto every line; what was missing is the other two dimensions. Every
  request log line therefore also carries:

  - the endpoint class: which surface was called - telemetry ingestion
    (collector, OTLP, browser telemetry), the dashboard's own calls, the
    public REST API, MCP, Langy, the AI gateway
  - the client source: what kind of caller made the request - one of our
    SDKs (with name, language and version), the CLI, MCP, a browser, curl,
    a generic OpenTelemetry exporter, some other HTTP client, or unknown

  Our SDKs have identified themselves on every request for a long time; the
  platform used to discard those headers. The one SDK that sent only a bare
  version now identifies itself like the others, and the MCP server names
  itself too. Classification can never fail a request: an unreadable or
  unfamiliar client lands in "unknown" and the request proceeds untouched.

  # ---------------------------------------------------------------------------
  # Client source
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A request from a LangWatch SDK names the SDK on the log line
    Given a request carrying the LangWatch SDK identity headers
    When the request is classified
    Then the client source is the SDK
    And the SDK name, language and version are carried alongside

  @unit
  Scenario: A request from the CLI is attributed to the CLI
    Given a request declaring the CLI surface
    When the request is classified
    Then the client source is the CLI

  @unit
  Scenario: A request from the LangWatch MCP server is attributed to MCP
    Given a request carrying the MCP server's identity
    When the request is classified
    Then the client source is MCP

  @unit
  Scenario: A curl request is attributed to curl
    Given a request whose user agent is curl
    When the request is classified
    Then the client source is curl

  @unit
  Scenario: A browser request is attributed to the browser
    Given a request whose user agent is a browser
    When the request is classified
    Then the client source is the browser

  @unit
  Scenario: A generic OpenTelemetry exporter is attributed as one
    Given a request from an OpenTelemetry exporter that is not ours
    When the request is classified
    Then the client source is an OpenTelemetry exporter

  @unit
  Scenario: A legacy Python SDK export still counts as an SDK
    Given a request carrying only the bare SDK version header older Python
      SDKs send
    When the request is classified
    Then the client source is the SDK

  @unit
  Scenario: An unidentified client is classified as unknown
    Given a request with no user agent and no identity headers
    When the request is classified
    Then the client source is unknown

  # ---------------------------------------------------------------------------
  # Endpoint class
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Telemetry ingestion paths are classed as ingestion surfaces
    When requests arrive on the collector, OTLP and browser telemetry paths
    Then each is classed as its own ingestion surface
    And the root-level OTLP aliases class the same as the canonical paths

  @unit
  Scenario: The dashboard's own calls are classed as dashboard traffic
    When a request arrives on the dashboard's RPC path
    Then it is classed as dashboard traffic

  @unit
  Scenario: Remaining API paths are classed as the public REST API
    When a request arrives on an API path claimed by no other surface
    Then it is classed as the public REST API

  # ---------------------------------------------------------------------------
  # The log line
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The request log line carries the attribution fields
    Given a classified request
    When the request is logged
    Then the endpoint class and client source appear on the log line

  @unit
  Scenario: MCP request logs carry the tenant and the client
    Given an authenticated MCP request
    When the request is logged
    Then the log line names the project the credential resolved to
    And the endpoint class and client source appear on the log line

  # ---------------------------------------------------------------------------
  # Clients identify themselves
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The Python SDK identifies itself on every request
    When the Python SDK sends telemetry or calls the API
    Then the request names the SDK, its language and its version

  @unit
  Scenario: The MCP server identifies itself on every request
    When the MCP server calls the LangWatch API
    Then the request names the MCP server and its version
