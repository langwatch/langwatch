# ADR-103: Feature contracts use Zod 4 behind Standard Schema

**Date:** 2026-08-21

**Status:** Accepted

**Related:** [ADR-101: feature package surfaces](./101-feature-package-surfaces.md),
[ADR-102: runtime composition roots](./102-runtime-composition-roots.md),
[strict feature layout](../../../packages/architecture-lint/adrs/002-versioned-strict-feature-layout.md),
and [Agents package boundary](../../../packages/features/agents/adrs/001-package-boundary.md).

## Context

Feature contracts need one schema to validate internal calls, REST or RPC
requests and responses, and the OpenAPI document. Coupling those schemas to a
Hono-specific Zod adapter makes the contract depend on a transport.

New feature packages are still in progress, so they can adopt Zod 4 without a
compatibility version. The existing application is much larger and still owns
Zod 3 schema graphs. Requiring a repository-wide migration merely to consume a
new feature would turn a package-boundary change into an unrelated application
rewrite.

`hono-openapi` version 1 validates and resolves schemas through Standard
Schema. Zod 3.25 and Zod 4 both implement that interface. The API framework can
therefore accept the standard rather than exporting either major's `ZodType`.

The `zod-openapi` package major is independent of the Zod runtime major. A
transitive `zod-openapi@4` package must not be treated as evidence that a
contract is using Zod 4.

## Decision

Governed feature contract packages author schemas with Zod 4, import it only
from `zod`, and infer their transport-safe types from those schemas. They do not
import `zod/v3`.

`@langwatch/api` exposes `ApiSchema` as a Standard Schema capability. Its
builders, validators, response validation, SSE events, discovery catalogue and
OpenAPI path accept that capability rather than a Zod-major type. A feature API
passes its contract-owned Zod 4 schemas directly.

Legacy application routes may continue to pass Zod 3.25 schemas through the
same Standard Schema boundary while their owners migrate. Where a legacy Zod 3
schema graph must compose a feature-owned Zod 4 schema, one explicit app-owned
adapter runs the feature validator and returns its parsed output; the feature
does not publish a duplicate Zod 3 schema.

Native schema errors are preserved when the schema exposes `safeParse`. A
validator that reports only Standard Schema issues is normalized into a real
error carrying `issues` and `flatten()`, so the existing handled-error boundary
can return a detailed validation response. This normalization does not depend
on `instanceof` across Zod majors.

OpenAPI 3.1 and RPC discovery remain compiled views of those same schema
objects. A transport may add documentation metadata, but it may not maintain a
second validation schema.

Architecture lint requires a Zod 4 manifest range in every governed contract
and rejects `zod/v3`, `@hono/zod-validator`, and `hono-openapi/zod` throughout
feature source.

## Alternatives considered

Keeping governed contracts on Zod 3 was rejected because these packages are
new and would begin with an obsolete runtime solely for application
compatibility. Migrating the whole application to Zod 4 in the same change was
rejected because Standard Schema provides the compatibility boundary without
that scope expansion. Supporting a Hono-specific adapter was rejected because
it would put transport details back into feature-facing code.

## Consequences

- Every governed feature contract has one Zod 4 schema and inferred type
  source.
- RPC, REST validation, SSE, discovery and OpenAPI consume Standard Schema.
- Existing Zod 3 application routes continue to compile during migration.
- Feature packages contain no Zod-major compatibility code.
- Validation errors remain detailed without relying on cross-major prototypes.
- Hono and schema-library upgrades can evolve independently behind the API
  boundary.
