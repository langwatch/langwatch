Feature: The MCP server addresses the canonical /api/v1 API
  Every REST family answers at `/api/{family}` and at `/api/v1/{family}`, and
  ADR-002 section 1 names the `/api/v1` form as the address clients call. Every
  LangWatch API call the MCP tools make therefore goes out under `/api/v1`, so
  an agent's request log and the published documentation agree.

  The families served only at their bare address keep the address they have:
  the sign-in door, the health probes, the legacy secrets family, the projects
  management family and the legacy track-event route, whose `/api/v1` names
  belong to other families.

  Background:
    Given the LangWatch MCP server

  Rule: Request paths carry the canonical generation

    @unit
    Scenario: Tool request paths are v1-form
      When the LangWatch API modules are read for request paths
      Then no request path addresses a REST family at its bare "/api" address

    @unit
    Scenario: A dashboard list goes out at the canonical address
      When the dashboards tool lists dashboards
      Then the request path begins with "/api/v1/dashboards"
