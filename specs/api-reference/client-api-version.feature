Feature: Clients name the API version they are written against

  Every LangWatch client sends X-API-Version on each request to the LangWatch
  API, naming the dated version it is written against: 2026-08-07, the
  version the management routes are registered at. The server does not read
  the header yet; clients that send it now can be pinned to their version
  later without a new release.

  @unit
  Scenario: The TypeScript SDK and CLI name the API version on every request
    Given a request sent through the TypeScript SDK's HTTP client
    When it leaves the client
    Then it carries X-API-Version "2026-08-07"

  @unit
  Scenario: A caller that names its own API version keeps it
    Given a request through the TypeScript SDK's HTTP client that already sets X-API-Version
    When it leaves the client
    Then it carries the caller's X-API-Version, once

  @unit
  Scenario: The MCP server names the API version on every request
    Given a request the MCP server makes to the LangWatch API
    When it leaves the server
    Then it carries X-API-Version "2026-08-07"

  @unit
  Scenario: The Python SDK names the API version on every request
    Given the headers the Python SDK builds for a LangWatch API request
    Then they carry X-API-Version "2026-08-07"
