# `.head()` registers a handler Hono can never reach

**Not a live outage** — every `.head()` in the tree sits beside a `.get()` on
the same path, and Hono answers HEAD from that GET. What is wrong is that four
handlers written to make HEAD cheap never run, and the published OpenAPI spec
documents HEAD operations that resolve through a different route than it says.

## The fact

`hono@4.13.1`, `hono-base.js` `#dispatch`:

```js
#dispatch(request, executionCtx, env, method) {
  if (method === "HEAD") {
    return (async () => new Response(null,
      await this.#dispatch(request, executionCtx, env, "GET")))();
  }
  const path = this.getPath(request, { env });
  const matchResult = this.router.match(method, path);
  …
```

HEAD is handled **before routing**. The request is re-dispatched as `GET`, and
the response is rebuilt with a null body. Consequences, all measured:

| | |
| --- | --- |
| `.on("HEAD", path, h)` then a HEAD request | **404** — nothing HEAD-shaped is ever matched |
| `.get(path, h)` then a HEAD request | 200, empty body — correct HTTP |
| both registered, HEAD request | the **GET** handler runs; the HEAD one is shadowed |
| `c.req.method` inside the handler on a HEAD request | reads **`"GET"`** |

That last row is the one that closes the door: a handler cannot detect that it
is serving a HEAD, so the work cannot be skipped from inside the GET route
either.

## What it costs today

`rest-api-service.ts`'s `bind()` routes `.head()` through `.on("HEAD", …)`, so
the handler is decoration. Four production sites pass one:

- `stored-object.api.ts:434` `.head("/:projectId/:id", … { method: "HEAD" })`
- `stored-object.api.ts:438` `.head("/:id", … { method: "HEAD" })`
- `user-avatar.api.ts:214` `.head("/:projectId/:id", … { method: "HEAD" })`
- `platform/app/src/server/routes/health.ts:15` `.head("/health", …)`

Each has a sibling GET, so the responses are correct. But
`handleFileRead(c, { method: "HEAD" })` — written to answer with headers and
skip the body — never runs. **A HEAD on a stored object or an avatar does the
full read and Hono throws the bytes away.**

The policy registration is not decoration: `registerRoutePolicy` runs, and
`generateOpenAPISpec` reads `allRegisteredRoutes()`. So the spec lists HEAD
operations whose documented handler is unreachable.

## The fork

1. **Delete `.head()` and the four registrations.** Truthful, and a pure
   deletion of unreachable code — HEAD keeps working through GET exactly as it
   does now. It also removes the HEAD entries from the generated OpenAPI spec,
   which is a published artefact: the operations would stop being documented
   even though the server still answers them.
2. **Keep `.head()` for the policy and the spec, drop the handler argument.**
   The spec keeps documenting HEAD, the registration stops implying a handler
   runs, and the four call sites lose their dead closures.

(2) looks right — the spec entry is the only thing `.head()` was really
producing, and it is worth producing. It is a public surface change across four
features, so it is written down rather than taken.

Neither resolution recovers the skipped read. That needs Hono to route HEAD, or
a body-skipping decision made outside the handler; on this version the handler
cannot know.

## Done meanwhile

`rest-api-service.unit.test.ts` asserted that a HEAD-only route answers 200. It
cannot, and the suite was red on it. It now asserts both halves of the real
contract — GET answers HEAD with the body dropped; a HEAD-only route 404s — and
`bind()`'s comment, which claimed `.on("HEAD", …)` was the shortcut, says what
actually happens instead.
