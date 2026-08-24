# ADR-103: First-party schemas use Zod 4 behind Standard Schema

**Date:** 2026-08-21

**Status:** Accepted

**Related:** [ADR-101: feature package surfaces](./101-feature-package-surfaces.md),
[ADR-102: runtime composition roots](./102-runtime-composition-roots.md),
[strict feature layout](../../../packages/architecture-lint/adrs/002-versioned-strict-feature-layout.md),
and [Agents package boundary](../../../packages/features/agent/adrs/001-package-boundary.md).

## Context

Feature contracts need one schema to validate internal calls, REST or RPC
requests and responses, and the OpenAPI document. Coupling those schemas to a
Hono-specific Zod adapter makes the contract depend on a transport.

Feature packages adopted Zod 4 first. The application has since moved its
direct schema runtime to Zod 4 as well, so keeping a first-party Zod 3 authoring
exception would now preserve complexity without preserving compatibility.
Third-party dependency graphs may still carry private Zod 3 copies; those are
not schemas authored or exported by LangWatch.

`hono-openapi` version 1 validates and resolves schemas through Standard
Schema. Zod 3.25 and Zod 4 both implement that interface. The API framework can
therefore accept the standard rather than exporting either major's `ZodType`.

The `zod-openapi` package major is independent of the Zod runtime major. A
transitive `zod-openapi@4` package must not be treated as evidence that a
contract is using Zod 4.

## Decision

All first-party packages author schemas with Zod 4, import it only from `zod`,
and infer their transport-safe types from those schemas. No first-party source
imports `zod/v3`. A third-party package may retain its own transitive Zod 3
dependency, but LangWatch source does not import or re-export that runtime.

`@langwatch/api` exposes `ApiSchema` as a Standard Schema capability. Its
builders, validators, response validation, SSE events, discovery catalogue and
OpenAPI path accept that capability rather than a Zod-major type. A feature API
passes its contract-owned Zod 4 schemas directly.

Native schema errors are preserved when the schema exposes `safeParse`. A
validator that reports only Standard Schema issues is normalized into a real
error carrying `issues` and `flatten()`, so the existing handled-error boundary
can return a detailed validation response. Standard Schema remains the API
framework boundary so feature contracts are not coupled to Hono or to Zod's
concrete TypeScript types.

OpenAPI 3.1 and RPC discovery remain compiled views of those same schema
objects. A transport may add documentation metadata, but it may not maintain a
second validation schema.

Architecture lint enforces only the architectural part of this decision:
strict feature source cannot depend on transport-specific
`@hono/zod-validator` or `hono-openapi/zod` adapters. The Zod major itself is
ordinary dependency management, not a custom lint policy.

## Alternatives considered

Keeping first-party contracts or application code on Zod 3 was rejected
because it creates two authoring models and cross-major adapters. Forcing
third-party packages to change their private dependency graphs was rejected
because those versions are not a LangWatch schema boundary. Supporting a
Hono-specific adapter was rejected because it would put transport details back
into feature-facing code.

## Consequences

- Every first-party package uses Zod 4 wherever it owns schemas, with contracts
  as the inferred type source for portable values.
- RPC, REST validation, SSE, discovery and OpenAPI consume Standard Schema.
- First-party source contains no Zod 3 compatibility graph.
- Validation errors remain detailed without relying on cross-major prototypes.
- Hono and schema-library upgrades can evolve independently behind the API
  boundary.
