Feature: The Python SDK addresses the canonical /api/v1 API
  Every REST family answers at `/api/{family}` and at `/api/v1/{family}`, and
  ADR-002 section 1 names the `/api/v1` form as the address clients call. The
  Python SDK's hand-written facades and its generated REST client therefore
  both build request paths under `/api/v1`.

  A family whose path already carries a generation of its own — `/api/otel/v1`,
  `/api/scim/v2`, `/api/gateway/v1`, `/api/webhooks/v1`, `/api/evaluations/v3` —
  is left alone, as are the routes the document keeps bare: the sign-in door,
  the health probes, trace ingestion, the legacy secrets and agents families,
  the projects management family, the legacy track-event route and the trace
  transcript route.

  Background:
    Given the LangWatch Python SDK

  Rule: Request paths carry the canonical generation

    @unit
    Scenario: Hand-written facade request paths are v1-form
      When the SDK facades are read for API request paths
      Then no request path addresses a REST family at its bare "/api" address

    @unit
    Scenario: The generated REST client is v1-form
      When the generated client's request URLs are read
      Then every family URL is addressed under "/api/v1"

    @unit
    Scenario: A dashboard read goes out at the canonical address
      When the SDK lists dashboards
      Then the request path begins with "/api/v1/dashboards"
