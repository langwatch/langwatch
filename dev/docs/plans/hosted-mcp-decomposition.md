# Hosted MCP decomposition plan

This is a decomposition plan for `modules/hosted-mcp/process/src/transport/hosted-mcp.api.ts`.
It does not change the hosted MCP implementation or its wire contract.

## Current boundary and framework integrations

`HostedMcpApp.createHandler()` constructs one `McpHandler` from the process's injected
dependencies. The handler currently combines route matching, CORS and JSON responses, OAuth
client registration and token exchange, API-key and grant authentication, Streamable HTTP and
SSE session management, Redis persistence, cross-replica SSE relay, rate limiting, reaping, and
shutdown in one closure.

There are two deliberately different HTTP integrations:

- `mcp-authorize.rest.ts` is a normal `defineRestRouter(McpAuthorizeApi)` family. It runs through
  the Hono REST runtime and uses the browser credential, typed input limits, and declared OAuth
  approval responses.
- The MCP protocol endpoints use the existing raw Node `http` integration. `McpHandler` accepts
  `IncomingMessage` and `ServerResponse` because the MCP SDK transports need the live request and
  response streams. The SDK integrations are `StreamableHTTPServerTransport` and
  `SSEServerTransport`; Hono cannot replace this streaming boundary.

The route policy registry is populated by `createMcpHandler()`, and the handler is exercised by
the raw `node:http` test servers in the hosted-MCP integration tests. A repository-wide caller
search currently finds no application host that calls `HostedMcpApi.createHandler()`; process
composition therefore still needs an explicit raw-HTTP mount when this feature is wired into a
running server.

## Proposed seams

1. Keep `HostedMcpApp` as the composition root. It creates the handler once, passes the typed
   `HostedMcpDependencies`, registers route policies once, and owns shutdown delegation.
2. Extract `McpHttpTransport` for the raw Node boundary: route matching, CORS, body limits,
   metadata/discovery answers, JSON/error responses, and dispatch to named operations. It owns no
   Redis keys, OAuth records, or MCP SDK session state.
3. Extract `McpAuthorizationService` and `McpOAuthTokenService` around the existing authorization
   and registry services. They own PKCE validation, redirect safety, token mint/redeem, encrypted
   API-key persistence, and grant re-check results. Existing Redis and cipher collaborators stay
   injected through `HostedMcpDependencies`.
4. Extract an `McpSessionChannel` for the two SDK transports and their lifecycle. It owns the
   local session maps, SDK `handleRequest` calls, Redis session records, SSE relay subscription,
   idle reaping, and close operations. The MCP SDK and ioredis are external clients owned by this
   channel.
5. Keep `McpRateLimitService` as the policy primitive and pass three named limiters into the
   transport/services. Authentication failures remain attached to the client-address channel.
6. Keep `mcp-authorize.rest.ts` as the Hono transport. Its `McpAuthorizeApi.approve()` operation
   should call the authorization service through the app API; it must not reach the raw MCP
   handler or duplicate redirect/error mapping.

## Contract shape to settle before implementation

`HostedMcpHandler` currently uses `request: object` and `response: object` in the contract while
the process implementation requires Node stream objects. Before moving code, choose one explicit
integration contract:

- keep the API process-private and expose a typed `NodeMcpHandler` from the process package, or
- make the contract method accept a named `HostedMcpRequest`/`HostedMcpResponse` port implemented
  by the Node host.

The contract should not retain an untyped `object` pair. The choice must preserve streaming,
`mcp-session-id`, SSE, CORS, and graceful shutdown. No REST runtime adapter should be introduced
for these protocol streams.

## Migration order and proof

Extract one seam at a time without changing route paths, OAuth response bodies, Redis key names,
TTL values, rate limits, session limits, or SDK transport options. Run the existing hosted-MCP
route, request-logging, API, and SSE integration suites after each extraction. Add focused tests
for the extracted transport/service/channel only where the existing integration tests cannot
observe the boundary. Wire the final typed handler through the process composition root, then
verify route-policy registration and graceful shutdown from the application host.
