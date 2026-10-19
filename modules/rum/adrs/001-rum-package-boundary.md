# ADR-001: RUM package boundary

**Status:** proposed

**Behavioural contract:** [Browser telemetry ingest](../specs/browser-telemetry-ingest.feature)

## Context

The platform's own browser exports traces; they must reach the platform's
collector through the app without the browser knowing the collector.

## Decision

`rum` owns ingesting the platform's browser telemetry. It exposes `RumApi`
(`ingestBrowserTraces`), which validates one OTLP/JSON export and forwards
it to the collector. The contract holds the Api token, the report shape, the
config, the secret handles and the `rum_*` handled errors.

## Public surfaces and transports

One REST transport, `rum.rest.ts`, which caps the body in bytes and hands the
report to the Api.

## Dependencies

No module dependencies. The logger and the process's telemetry exporter are
members; the exporter is read only as the deprecated collector fallback.

## Persistence

A rate-limit repository with Redis and memory twins.

## Runtime and registration

`rumProcessModule` registers the repositories, the Api and the REST
transport. The collector is a channel with HTTP and memory twins.

## Environment and configuration

`rumConfig`, `rumBrowserConfig` and `rumSecrets` enter at composition;
module code reads no environment.

## Errors

Every refusal is a `rum_*` handled error; nothing is forwarded on a refusal.

## Contracts and validation

`rumReportHeadersSchema` parses the session and forwarding headers; the body
is capped by the door before the service sees it.

## Consequences

The browser talks only to the app; the collector address stays server-side.
