# ADR-001: Enterprise web composition stays role-specific

**Status:** Accepted

**Behavioural contract:** [Enterprise web composition](../specs/web-composition.feature)

## Context

Browser feature implementations need a composition boundary that can consume
portable contracts without importing Node, persistence, or server feature code.

## Decision

`@langwatch/enterprise-web` exports a class with `static create` for shell
state. Licensed rendered feature surfaces live in their Enterprise feature web
package and are mounted by the application through thin route adapters.

## Public surfaces and transports

The package exposes web composition state and coordinates feature web
installers. Rendered governance components live in the Enterprise governance
web package; application code provides only host UI/RPC adapters.

## Dependencies

The web composition may depend on portable contracts and Enterprise web
surfaces, but never API, worker, server, Node, or persistence packages.

## Persistence

Not applicable. The web boundary owns no persistence and receives only
portable serialized state from its physical user-interface application.

## Runtime and registration

Construction is explicit through `EnterpriseWebComposition.create`; importing
the package does not mount providers, components, routes, or global state.

## Environment and configuration

The package reads no environment variables. Public runtime configuration must
be validated by the physical web application before composition.

## Errors

The shell does not translate feature errors. Portable handled error contracts
remain owned by the feature or the shared error package.

## Contracts and validation

Initial license status uses the portable licensing contract, ensuring browser
composition never imports cryptography or server implementation source.

## Consequences

Web assembly has an explicit class boundary while a separate licensing web
package remains unnecessary until it owns independent rendered behavior.
