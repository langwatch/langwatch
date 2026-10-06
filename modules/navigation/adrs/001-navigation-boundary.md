# ADR-001: Navigation owns the shell's chrome and the addresses no feature owns

**Status:** Accepted

**Behavioural contract:** [Navigation modes](../specs/navigation-modes.feature)

**Related:** `dev/docs/ARCHITECTURE.md` sections 3.4 and 10.

## Context

The application shell (icon rail, product sidebars, command bar, organization and project
switchers, mobile chrome) and a few addresses belong to no one feature: the landing redirect, the
404 every unmatched address falls to and the `@project` forward. Every product screen sits inside
this chrome, so it must not import a feature's internals nor be imported by one.

## Decision

`navigation` is a browser-only module. It owns the shell chrome, the command bar and its
catalogue, product memory, landing and organization-switch destination rules, and the screens
for the landing, not-found and `@project` addresses. Features place their screens through their
own declarations; navigation reads their destinations and never their components.

## Public surfaces and transports

`navigationWeb` installs the three screens and the host `navigationApi`. Other browsers see
navigation's lends and host services, never its `ui/` files. There is no contract package and
no transport of its own.

## Dependencies

The browser reads the feature-flag tRPC declaration (`featureFlagTrpc`, declared on the module's
`withApi` contracts) and the host services of `@langwatch/browser-host`. A destination another
module contributes arrives through the shell's registration, not an import.

## Persistence

None on the server. Product memory (the last product visited per organization) is kept in
`localStorage` and is not watched, so a change causes no re-render.

## Runtime and registration

`defineBrowserModule("navigation")` is installed by the shell; `sidebarCapability` lends the
sidebar to the products that mount one. The layers run `model/` (pure rules), `behavior/`
(hooks and the host), `ui/` (elements, blocks, sections).

## Environment and configuration

None. A release flag arrives through the feature-flag read, never a config leaf.

## Errors

An address nothing matches renders the not-found scene; an organization-less user is sent to the
orgless destination rule, not an error.

## Contracts and validation

Destination and command shapes are typed in `model/`. The scenarios under `specs/` are the
requirements, bound by the model unit tests and the shell integration tests.

## Consequences

A new feature appears in the shell by declaring a destination, not by editing navigation. The
shell's chrome changes in one place. Scenarios that concern the whole application's routes
(registration, redirects) stay in `specs/navigation` beside the application's route table.
