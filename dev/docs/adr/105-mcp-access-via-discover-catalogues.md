# ADR-105: MCP access via the rpc.discover catalogues

**Date:** 2026-08-21

**Status:** Proposed

**Related:** [RPC-first fluent registration](../../../packages/api/adrs/001-rpc-first-fluent-registration.md),
[explicit version namespaces](../../../packages/api/adrs/002-explicit-version-namespaces.md),
[the API discovery contract](../../../packages/api/specs/api-discovery.feature),
and the behavioural contract [rpc-tools-from-catalogues.feature](../../../specs/mcp-server/rpc-tools-from-catalogues.feature).

## Context

Every `@langwatch/api` service now publishes its RPC operations twice over:
once in the OpenAPI document, and once through the two-level `rpc.discover`
catalogues — a root index naming each service's catalogue URL, and a
per-service catalogue carrying each operation's name, path, documentation and
JSON Schemas. The catalogues are projections of the same registrations the
document is generated from, so they cannot drift from the served surface.

Separately, the MCP server (`mcp/typescript`) exposes hand-written tools, one
registration per endpoint. A new RPC endpoint today is invisible to MCP
clients until someone writes a tool for it — the same drift the catalogue
exists to prevent. The question is how an RPC service becomes MCP-accessible
without per-service work, and without changing what services speak.

Services speak plain HTTP POST + JSON. JSON-RPC 2.0 is what MCP clients speak
to the server — and only that. Nothing about MCP access should leak a second
wire contract into the services themselves.

## Decision

### 1. One thin adapter, driven by the catalogues

The MCP server discovers its RPC tools at startup: it POSTs the root
`/api/rpc.discover` for the service index, then each service's catalogue URL
for its operations. Every catalogued operation becomes an MCP tool. A new
documented RPC endpoint becomes a tool with zero per-service work — it is
catalogued because it is documented, and it is a tool because it is
catalogued.

Calling a tool POSTs the tool's arguments, as the JSON body, to the
operation's documented path (`/api/{service}/latest/{name}`), authenticated
with the configured LangWatch API key like every other call the server makes.
Services see an ordinary RPC call; JSON-RPC 2.0 exists only inside the MCP
server, owned by the official `@modelcontextprotocol/sdk`, and never enters
a service.

### 2. Tool names map the dotted name to the MCP charset

MCP tool names do not carry dots. The adapter maps `things.create` to
`things_create` — dots to underscores, the only transformation the MCP-safe
charset requires of the RPC grammar. The mapping is checked at discovery: two
operations mapping to one tool name fail startup with both names, rather than
one silently shadowing the other.

### 3. The catalogue's schemas are the tool's schemas

A tool's `inputSchema` is derived from the operation's catalogue input JSON
Schema (a `null` input produces a no-argument tool). The catalogue schema is
produced from the endpoint's zod schema; the MCP SDK speaks zod, so the
adapter converts the catalogue's JSON Schema back, and the SDK re-derives the
advertised schema from that. The fields, types and descriptions are the
catalogue's; the conversion is lossy at the margins, which is acceptable
because validation on the service side is authoritative either way — the MCP
schema is for the client to shape its call, not for the service to trust.

### 4. Discovery failure fails the startup

A catalogue that cannot be fetched — unreachable root index, a service
catalogue that errors, a name collision — fails the server startup with a
clear error. The alternative, serving with fewer or no RPC tools, is
undiscoverable from the client side: the server looks healthy and the tools
are simply absent, which is the failure mode this rework exists to eliminate
everywhere else.

## Alternatives considered

A hand-written tool per endpoint was rejected: it is the status quo, and it
drifts — every endpoint is one forgotten registration away from being
invisible to MCP clients, with nothing noticing.

OpenAPI→MCP generators were rejected: the document deliberately includes the
REST and legacy surface, so generated tools would carry that noise, while the
catalogue is curated to documented RPC operations only — exactly the set that
should become tools.

JSON-RPC 2.0 in the services was rejected: it would split the wire contract
every client, SDK and gateway rule has to understand, to serve one consumer
that already has an SDK capable of owning the translation.

## Consequences

- Every documented RPC operation is MCP-accessible the moment it ships; no
  per-service MCP work exists.
- The MCP server startup depends on the platform being reachable — a
  deliberate fail-closed, traded against silently missing tools.
- JSON-RPC 2.0 remains an MCP-transport concern; services, SDKs and the
  gateway see one wire contract.
- The JSON Schema → zod conversion in the adapter is the one lossy seam; it
  is bounded, tested against the constructs the catalogues actually emit, and
  never authoritative.
