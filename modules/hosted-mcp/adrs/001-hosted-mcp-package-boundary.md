# ADR-001: Hosted MCP package boundary

**Status:** proposed

**Behavioural contract:** [Hosted MCP answers main's root paths on the api process](../specs/hosted-mcp.feature)

## Context

MCP clients reach LangWatch over main's MCP root paths and sign in through an
OAuth consent flow; the SDK transports write the response themselves.

## Decision

`hosted-mcp` owns the hosted MCP endpoint, its sessions and its OAuth flow.
`HostedMcpApi` creates the endpoint handler; the consent page's approval is
the module's `McpAuthorizeApi`.

## Public surfaces and transports

A raw HTTP door on the api process for main's MCP root and metadata paths,
answered ahead of every route and closed at shutdown. `POST
/api/mcp/authorize` with a browser credential: a signed-in person approves a
client for one project they may act on, and no code is issued while an
operator impersonates a member. Tokens are person-bound and project-capped;
an expired or unrecognised access token is answered 401 with a challenge.

## Dependencies

`ProjectApi`, `AuthzApi` (grant re-checks), `AuthApi` (access and refresh
tokens) and `GovernanceRestApi` (session tools). Members read: `redis`,
`encryption`, `publicBaseUrl`.

## Persistence

OAuth clients, authorization codes and sessions in Redis, with memory twins
for clients and sessions. The session relay is a channel with Redis and
memory tiers.

## Runtime and registration

`hostedMcpProcessModule` registers the Api, the authorize REST router and the
endpoint door. No pipeline, job or subscriber.

## Environment and configuration

No config slice. The module refuses to boot without `publicBaseUrl`.

## Errors

OAuth refusals in the RFC 6749 shape; 401 with `WWW-Authenticate` for a
bearer that must re-authorise; `api_key_scope_violation` when a person's
session calls a governance ingestion template tool.

## Contracts and validation

The approval body and the authorization-code record are contract Zod schemas.

## Consequences

MCP sign-in binds a person to one project and issues no project key; a
project key presented directly is checked as its own caller.
