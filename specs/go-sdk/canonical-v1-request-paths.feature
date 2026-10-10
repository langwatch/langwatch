Feature: The Go SDK addresses the canonical /api/v1 API
  Every REST family answers at `/api/{family}` and at `/api/v1/{family}`, and
  ADR-002 section 1 names the `/api/v1` form as the address clients call. The
  Go client's hand-written paths and its generated oapi-codegen client both
  build request paths under `/api/v1`.

  Trace ingestion keeps its own address: the OTLP exporter posts to
  `/api/otel/v1/traces`, which already carries a generation, and the REST
  collector is the ingestion door rather than a published family.

  Background:
    Given the LangWatch Go SDK

  Rule: Request paths carry the canonical generation

    @unit
    Scenario: The track-event path is v1-form
      When the client sends a customer event
      Then the request path is "/api/v1/events/track"

    @unit
    Scenario: The generated client's request paths are v1-form
      When the generated client's operation paths are read
      Then no operation addresses a REST family at its bare "/api" address
