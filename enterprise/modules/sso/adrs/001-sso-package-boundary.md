# ADR-001: SSO is an explicitly configured Enterprise feature

**Status:** Accepted

**Behavioural contract:** [Enterprise SSO](../specs/sso.feature)

**Related:** [ADR-027 license-gated SSO](../../../../../dev/docs/adr/027-license-gated-sso.md), [ADR-096 SAML verified email](../../../../../dev/docs/adr/096-saml-logins-count-as-verified-emails.md)

## Context

Enterprise SSO matching, provider construction, license verification, Prisma
access, and environment reads previously lived together under the application
`ee` tree.

## Decision

Own portable SSO configuration and matching in a contract package and own the
gate and provider builders in a server package. The gate consumes the shared
Licensing service contract; SSO does not implement license verification or
license persistence.

## Public surfaces and transports

The contract exposes Zod configuration, matching predicates, and the `SsoGate`
capability. The server exposes class services/adapters and Better Auth config
builders without owning HTTP routes.

## Dependencies

The contract depends only on Zod 4. The server depends on the SSO and Licensing
contracts and Better Auth's portable provider types.

## Persistence

SSO owns no persistence. The Licensing service scans and verifies instance and
organization license candidates through its one private repository.

## Runtime and registration

`LicensingSsoAdapter.create(...).build()` constructs the gate from the shared
Licensing service. Importing either package has no registration or connection
side effects.

## Environment and configuration

Feature packages never read environment variables. The application maps its
environment to `SsoConfiguration`; the Licensing composition owns license
verification keys.

## Errors

Licensing-store failures and timeouts deny SSO for that request, evict the
failed decision, and retry later. Configuration that cannot mount falls back
to email with an operator warning.

## Contracts and validation

Configuration and matching data use portable Zod 4 schemas and semantic field
names rather than application environment names.

## Consequences

The app keeps its Better Auth hooks and process composition while reusable SSO
policy no longer imports app aliases, globals, environment, or generated data.
