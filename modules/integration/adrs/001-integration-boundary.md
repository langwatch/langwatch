# ADR-001: Integration owns the Integrations settings screen

**Status:** Accepted

**Behavioural contract:** [GitHub connection](../specs/github-connection.feature)

**Related:** `dev/docs/ARCHITECTURE.md` sections 3.4 and 10.

## Context

An organization connects outside services (GitHub, Slack, and the Langy code-access choice) from
one settings page. The services themselves belong to their own modules (`github`, `slack`,
`langy`); the page that lists them and walks an administrator through connecting is a screen of
its own.

## Decision

`integration` is a browser-only module that owns the Integrations screen, the GitHub, Slack and
Langy code-access cards, and the host that mounts the GitHub install flow. It reads each service
through that module's contract and never reaches its process half or its tables.

## Public surfaces and transports

`integrationWeb` registers the `pages/settings/integrations` screen at `/settings/integrations`
within the settings chrome, requiring `organization:view`, and mounts `GithubHostApi`. No
contract package and no server transport of its own.

## Dependencies

The browser reads `github`, `slack` and `langy` through their contracts and lends. It
needs the settings chrome from the shell and the install address from GitHub's contract.

## Persistence

None. Every connection is owned and stored by the module that provides the service.

## Runtime and registration

`defineBrowserModule("integration")` is installed by the shell. The GitHub host is lent through a
mount loaded on demand; the screen itself loads lazily.

## Environment and configuration

None. Whether GitHub is configured on the instance is answered by the github module and hides
the card when it is not.

## Errors

A failed GitHub installation is reported once and dropped from the address. A service that
refuses (not configured, not permitted) hides or disables its card rather than breaking the page.

## Contracts and validation

Address and install shapes are parsed in `model/`. The scenarios under `specs/` are the
requirements, bound by the card and screen integration tests.

## Consequences

A new integration adds a card here and a contract elsewhere; no service module learns about the
page. The GitHub scenarios are shared with the github module's server half, which proves its own
steps in its transport tests.
