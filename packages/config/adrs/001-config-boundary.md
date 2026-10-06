# ADR-001: Config is declared where it is owned and parsed once

**Status:** Accepted

**Behavioural contract:** [Public base URL](../specs/public-base-url.feature)

**Related:** `dev/docs/ARCHITECTURE.md` section 6 and
[secrets are not config](../../../dev/docs/adr/132-secrets-are-not-config.md).

## Context

A deployment is configured through environment variables. If every module reads
`process.env` itself, two owners can bind one variable differently, a typo surfaces at first use
and a secret can leak into a config slice.

## Decision

`@langwatch/config` provides the framework: `Config.define` lets an owner attach hand-written Zod
leaves with their env spellings where the owner is defined, and `parseProcessConfig` parses the
process's declared owners once, refusing by owner, path and variable name. Leaves shared by several
owners (public base URL, release version, the NLP service URL, the code-block timeout) are
exported here and may be re-bound only as the same leaf. A leaf that claims a secret is refused
(`ConfigClaimsSecretError`). Feature leaves do not live in this package.

## Public surfaces and transports

The root exports `Config`, `ConfigLeaf`, `parseProcessConfig`, the three error classes, the
deployment-fact leaves and the dev-port alignment. `./public-app-config` and its projection export
the browser-safe subset the UI bootstrap reads.

## Dependencies

Zod and `@langwatch/handled-error` for the refusals. Modules and apps depend on this
package; it depends on no module.

## Persistence

None.

## Runtime and registration

Nothing registers at import. A process lists its owners in `config.ts` and the container parses
them once at boot; each module then reads its own slice.

## Environment and configuration

This package is the mechanism. It reads the environment only through the process's parse, never
at import time.

## Errors

A bad value, a collision between two owners and a leaf that claims a secret each refuse boot by
name, with the owner, the path and the variable.

## Contracts and validation

Each leaf is a Zod schema; the slice type is inferred from the declaration. The scenarios under
`specs/` are the requirements for the shared leaves, bound by the package's unit tests.

## Consequences

A configuration mistake fails at boot in one place, and a module cannot read a variable it did not
declare. Adding a shared leaf is a change to this package; adding a feature leaf is a change to
the feature.
