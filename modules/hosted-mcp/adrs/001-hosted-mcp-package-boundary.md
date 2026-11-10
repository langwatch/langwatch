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

`POST /mcp/docs` is the one MCP path that takes no credential, and the one
langwatch.ai/docs/mcp forwards to now that the docs site no longer serves its
own MCP. It serves only `fetch_langwatch_docs` and `fetch_scenario_docs`,
whose fetch stays locked to https://langwatch.ai/docs/ and /scenario/, and
ignores any credential it is sent. It runs the Streamable HTTP transport in
stateless mode: a fresh server per request, no session id, nothing written to
any store, so an anonymous caller cannot fill session storage. GET and DELETE
answer 405. So that one request cannot fan out into many fetches, a body
must be a single JSON-RPC message (a batch answers -32600) of at most 64 KB
(413). Each process runs at most 16 docs fetches at once for this endpoint
(past that, a tool call answers an error asking it to retry) and serves a
repeated page from a 60-second cache. A fetch is aborted when its client
disconnects. There is no per-caller limit: traffic arrives through
CloudFront, so it would throttle every caller at once. `/mcp` itself is unchanged: MCP clients discover sign-in from its
401 challenge, so it never answers anonymously. `report_issue` is left out of
the docs endpoint: it posts to the configured endpoint, so it is not
config-free, and it would let anyone relay reports through the platform.

## Dependencies

`ProjectApi`, `AuthzApi` (grant re-checks), `AuthApi` (access and refresh
tokens) and `GovernanceRestApi` (session tools). Config: `publicBaseUrl`.
The live repository tier requires `redis` and `encryption`; the memory tier
requires nothing.

## Persistence

OAuth clients, authorization codes and sessions in Redis, with memory twins.
The session relay (Redis pub/sub that carried messages to the replica holding
an SSE stream) was removed with the SSE transport; `/sse` now answers the
Streamable HTTP transport, which needs no relay.

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
