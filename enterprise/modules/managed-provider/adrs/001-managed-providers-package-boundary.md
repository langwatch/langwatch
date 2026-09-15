# ADR-001: Managed provider credentials are injected

**Status:** Accepted

**Behavioural contract:** [Managed model providers](../specs/managed-providers.feature)

## Context

Managed Bedrock routing read ambient environment, Prisma, and AWS STS from one
module, while its alert component imported a server registry type.

## Decision

Create portable contract, server, and web packages. A service owns policy, a
configuration adapter parses an injected source, a Prisma repository resolves
project ownership, and an AWS adapter performs role chaining.

## Public surfaces and transports

Each package exposes only its root. App routes delegate to the service; the web
package exports a browser-safe alert taking the portable provider shape.

## Dependencies

The contract uses Zod 4. The server uses AWS STS and its own contract. Only the
canonical Prisma repository imports the generated client.

## Persistence

Project-to-organization resolution is behind an abstract repository with a
Prisma implementation. The service owns only a bounded process-local cache.

## Runtime and registration

All concrete server collaborators are classes with `static create`. Imports
do not parse configuration, create AWS clients, query Prisma, or register routes.

## Environment and configuration

Composition passes a string record to the configuration adapter. Feature
packages never read `process.env` directly.

## Errors

Malformed entries are skipped and reported through an injected logger;
duplicate organization entries and incomplete STS credentials fail explicitly.

## Contracts and validation

Configuration and provider inputs use portable Zod 4 schemas. AWS credential
objects remain server-private.

## Consequences

Managed provider policy is reusable by API and worker runtimes without an app
singleton, while the browser depends on no server registry declaration.
