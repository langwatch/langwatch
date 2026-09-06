# 007: HEAD is answered from GET, so a HEAD handler never runs

**Date:** 2026-09-06

**Status:** Accepted

## Context

`.head()` on the REST service builder registered a handler through
`.on("HEAD", path, h)`. On `hono@4.13.1` that handler can never run. Hono's
`#dispatch` handles HEAD **before routing**: it re-dispatches the request as
`GET` and rebuilds the response with a null body.

Measured on that version:

| | |
| --- | --- |
| `.on("HEAD", path, h)`, then a HEAD request | **404**. Nothing HEAD-shaped is ever matched |
| `.get(path, h)`, then a HEAD request | 200 with an empty body, which is correct HTTP |
| Both registered, HEAD request | The **GET** handler runs. The HEAD one is shadowed |
| `c.req.method` inside the handler on a HEAD request | Reads **`"GET"`** |

That last row closes the door. A handler cannot detect that it is serving a
HEAD, so the work cannot be skipped from inside the GET route either.

This was never an outage. Every `.head()` in the tree sits beside a `.get()` on
the same path, so the responses are correct. What is wrong is that four handlers
written to make HEAD cheap never run, and the published document names HEAD
operations that resolve through a different route than it says. A HEAD on a
stored object or an avatar does the full read and Hono throws the bytes away.

## Decision

`head` stays on `HttpMethod`, and `.head()` keeps registering the route for the
policy registry and for the published document. It does not take a handler
argument, and the framework says at the registration site that Hono answers HEAD
from the GET route before routing.

The alternative was to delete `.head()` and the four registrations. That is
truthful and is a pure deletion of unreachable code, but it also removes the
HEAD entries from the generated OpenAPI document, which is a published artefact.
The operations would stop being documented even though the server still answers
them. The registry entry is the only thing `.head()` was really producing, and
it is worth producing.

## Consequences

The four call sites lose their dead closures. The document keeps its HEAD
operations. Nothing recovers the skipped read: that needs Hono to route HEAD, or
a body-skipping decision made outside the handler.

`rest-api-service.unit.test.ts` asserts both halves of the real contract. A GET
answers HEAD with the body dropped, and a HEAD-only route answers 404. It
previously asserted that a HEAD-only route answers 200, which cannot happen.

## References

- [The REST chain extensions](./005-rest-chain-extensions.md)
