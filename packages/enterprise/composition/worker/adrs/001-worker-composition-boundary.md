# ADR-001: Enterprise worker composition stays role-specific

**Status:** Accepted

**Behavioural contract:** [Enterprise worker composition](../specs/worker-composition.feature)

## Context

Worker feature implementations need an explicit future assembly boundary that
cannot silently acquire API routes or browser feature dependencies.

## Decision

`@langwatch/enterprise-worker` exports a class with `static create` and begins
as an empty role-specific shell over the portable Enterprise catalogue.

## Public surfaces and transports

The package exposes composition state only. Queue consumers, jobs, and event
handlers remain owned by the server feature packages that implement them.

## Dependencies

The worker composition may depend on portable contracts and Enterprise server
surfaces, but never API, web, React, or browser implementation packages.

## Persistence

Not applicable. Feature persistence remains behind injected repositories and
is constructed by the physical worker application when eventually required.

## Runtime and registration

Construction is explicit through `EnterpriseWorkerComposition.create`; imports
perform no queue subscription, feature registration, or background startup.

## Environment and configuration

The package reads no environment variables. Physical worker configuration will
be validated before feature dependencies are supplied to composition.

## Errors

Not applicable. The shell performs no operations today, and future feature
errors must retain their feature-owned handled error contracts.

## Contracts and validation

The portable catalogue provides the available feature vocabulary; future
worker options will use explicit typed feature server capabilities.

## Consequences

Worker composition has a legal and architectural home without pretending that
licensing currently owns an independent worker implementation.
