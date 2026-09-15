Feature: The TypeScript SDK addresses the canonical /api/v1 API
  Every REST family answers at `/api/{family}` and at `/api/v1/{family}`, and
  ADR-002 section 1 names the `/api/v1` form as the address clients call. The
  SDK, the CLI and the generated OpenAPI client therefore all build request
  paths under `/api/v1`, so a customer reading a request log sees the same URL
  the published documentation names.

  A family whose path already carries a generation of its own — `/api/otel/v1`,
  `/api/scim/v2`, `/api/gateway/v1`, `/api/webhooks/v1` — is left alone: two
  generation segments in one URL would be two version axes. So are the routes
  the document keeps bare because their `/api/v1` name belongs to another
  family or to nothing at all: the sign-in door, the health probes, trace
  ingestion, the legacy secrets and agents families, the projects management
  family, the legacy track-event route and the trace transcript route.

  Background:
    Given the LangWatch TypeScript SDK

  Rule: Request paths carry the canonical generation

    @unit
    Scenario: Hand-written service request paths are v1-form
      When the client services and CLI commands are read for API request paths
      Then no request path addresses a REST family at its bare "/api" address

    @unit
    Scenario: The generated OpenAPI client is v1-form
      When the generated OpenAPI client's path keys are read
      Then every documented family key is addressed under "/api/v1"

    @unit
    Scenario: A prompt read goes out at the canonical address
      When the SDK reads a prompt by handle
      Then the request URL path begins with "/api/v1/prompts"

  Rule: An already-versioned family keeps its own generation

    @unit
    Scenario: The OTLP exporter paths are left alone
      When the SDK's telemetry exporter paths are read
      Then they stay at "/api/otel/v1" rather than gaining a second generation
