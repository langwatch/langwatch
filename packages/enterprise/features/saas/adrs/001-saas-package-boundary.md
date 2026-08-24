# ADR-001: SaaS browser integrations are explicit

**Status:** Accepted

**Behavioural contract:** [SaaS browser integrations](../specs/saas.feature)

## Context

SaaS footer integrations previously imported application hooks and the tRPC
client directly from an Enterprise catch-all directory.

## Decision

Create a portable SaaS contract and browser-only web implementation. The app
supplies session, organization, project, mutation, and script capabilities.

## Public surfaces and transports

The contract and web package each expose only their root. No backend transport
or server package is part of this feature.

## Dependencies

The contract uses only Zod 4. The web package uses React and browser analytics
libraries and imports no application source.

## Persistence

SaaS browser integrations own no database tables, repositories, browser
storage, or cookies. Session, organization, and project context are supplied
for the duration of a render, and analytics delivery is delegated immediately
through injected callbacks. Retry state is bounded to the mounted browser
component and is discarded on unmount; it is not a durable source of truth.

## Runtime and registration

The web composition explicitly renders the component. Package import performs
no analytics registration and loads no third-party script.

## Environment and configuration

The app passes an allow-listed `isSaas` flag and build environment string.

## Errors

Unavailable analytics globals are retried and remain non-blocking. Missing
optional browser context renders nothing.

## Contracts and validation

Portable browser context is expressed by Zod 4 schemas and structural callback
capabilities.

## Consequences

SaaS analytics keep current behavior without importing app hooks from a feature
web package.
