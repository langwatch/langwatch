# Error Handling

See [ADR-045](../adr/045-domain-errors-handled-boundary.md) for the architectural
decision. This doc is the day-to-day convention.

One rule underpins everything: **only handled errors cross an API boundary with
meaning; everything else is reported as unknown.** A `HandledError` is a promise
to the caller that we understood what happened and they can act on it. Do not
make that promise lightly, and do not withhold it when it is true.

## Is this a HandledError?

Both must hold:

1. **We know the cause.** Not "we caught an exception here" — we can name the
   failure: not found, forbidden, validation failed, quota exceeded, timed out,
   provider rejected the request.
2. **The caller can act on it.** They can fix their input, change a setting, wait,
   or upgrade. "Retry and hope" is not acting.

If either fails, throw a plain `Error`. A Postgres connection drop, a nil
dereference, a ClickHouse OOM, a bug — these have no user-relevant meaning, and
dressing them up as handled errors leaks internals and lies to the caller.

**"Unknown" is a correct, intended outcome.** An unhandled error producing a
generic client response plus a trace id is the system working as designed. Do not
invent a handled error to avoid it.

```ts
// ✅ known + actionable
throw new PromptNotFoundError(promptId);

// ✅ known + actionable, wrapping an internal cause that stays masked
throw new DatasetUnavailableError(datasetId, { reasons: [pgError] });

// ❌ unknown cause dressed as handled — caller can't act on it
throw new DatabaseError("database_error", pgError.message);

// ✅ the same failure, correctly
throw pgError; // degrades to "unknown" at the boundary, logged with the trace id
```

## Authoring one

Handled errors live in a per-domain `errors.ts` next to the code that throws
them, as subclasses with a stable `code`.

```ts
export class PromptNotFoundError extends NotFoundError {
  declare code: "prompt_not_found";

  constructor(promptId: string, options: HandledErrorOptions = {}) {
    super("prompt_not_found", "Prompt", promptId, {
      ...options,
      fault: "customer",
      meta: { promptId, ...options.meta },
    });
  }
}
```

Each field earns its place:

| field | rule |
|---|---|
| `code` | Stable, `snake_case`, unique platform-wide. This is the wire discriminant, the key every client explainer is written against, **and the literal wire message** — renaming one is a breaking change. |
| `message` | **Server copy, for logs — it does not reach the client.** Write it for whoever is reading the trace, so naming an env var or an internal service is fine and useful. Customer-facing copy lives in the client presentation registry, keyed by `code`. See "Where the words come from" below. |
| `fault` | Who can act. Drives **log level and alerting**, not UI. Defaults to `customer` — so any subclass with a 5xx status must set `platform` or `provider` explicitly, or a real incident logs as routine noise. |
| `meta` | Structured context the **client can actually use**. Not a debug dump. If no UI reads a field, it does not belong here — put it in the log instead. |
| `tips` | Short, actionable, imperative. Written for an agent driving the API/CLI/MCP with no UI to fall back on. |
| `docsUrl` | Canonical `docs.langwatch.ai` link. CI asserts every one resolves. |
| `reasons` | The cause chain. Non-handled links serialise as `{ code: "unknown" }` automatically — safe to pass an internal error here. |

`tips` and `docsUrl` are centralised in
`langwatch/src/server/app-layer/error-remediation.ts`. Add remediation copy there,
not inline at the throw site.

### `meta` is a contract, not a scratchpad

The client only reads `meta` for codes where it knows the shape. A field nothing
renders is dead weight on the wire and an invitation to leak something. Before
adding one, name the UI that consumes it.

```ts
// ✅ the rename dialog renders "got 340 chars" from these
meta: { field: "name", maxLength: 255, receivedLength: 340 }

// ❌ debug dump — nothing renders this, and it leaks query shape
meta: { query: rawSql, durationMs: 4210, shard: "ch-03" }
```

## Where the words come from

This is the part that trips people up, so be precise about it:

| | source |
|---|---|
| What the customer reads | The **client presentation registry**, keyed by `code` |
| `HandledError.message` | Server-side only — logs, OTel, exception capture |
| The wire `message` field | **The `code` itself**, on every transport ([#5984](https://github.com/langwatch/langwatch/pull/5984)) |
| Server-authored dynamic prose | `meta.message`, an explicit opt-in — mirrors Go, where free text appears only when a caller sets `Meta["message"]` |

Handled-error messages were leaking env vars and internal hostnames to browsers,
so the wire now carries only the stable code where a message is required. The
consequence: **`error.message` on the client is a code slug, not a sentence.**
Rendering it directly puts `validation_error` in front of a customer.

## Surfacing one to the user

The server emits the typed fact; the client decides presentation. Principles,
in order of how often they are violated:

1. **Never toast a raw `error.message`.** For a handled error it is the code
   slug; for an unhandled one it is unsafe. Read the handled payload and render
   from the registry; fall back to the generic unknown state.
2. **Title and description both come from the `code`**, not the server. The
   registry owns the customer-facing copy, with a `fault`-based fallback for
   codes it doesn't know (customer → "Check your input", platform/provider →
   "Something went wrong on our end").
3. **Render `tips` and `docsUrl`.** They exist; showing them is the whole point of
   the remediation channel.
4. **Never render raw `meta` or the reason chain in the UI.** They are for agents
   and logs. A customer sees message, tips, docs, and a copyable error id.
5. **Validation errors belong on the form, not in a toast.** Map
   `meta.fieldErrors` onto the offending fields and make it visually obvious the
   server rejected the submission.
6. **Unhandled errors get one calm generic state** plus the copyable error id —
   never the raw text.

Everything lives in `langwatch/src/features/errors`: `readHandledError` to lift
the payload, the code-keyed registry for the words, `showErrorToast` and
`<HandledErrorAlert>` to render them, and `applyHandledErrorToForm` for a
rejected submit. Do not hand-roll `error.data?.error` at a call site — three
separate ad-hoc readers is how this got inconsistent the first time.

## Non-tRPC transports

Streamed and proxied transports carry the identical shape:

- **SSE / NDJSON** error frames carry the serialised `domainError` alongside the
  message. A non-handled stream failure degrades to the generic unknown message —
  never raw error text onto an already-200 stream.
- **Hono REST** — throw the `HandledError`; `createServiceApp`'s `onError`
  serialises it. Hand-rolling `c.json({ error: "..." }, { status })` is a code
  smell and bypasses the whole contract.
- **Go services** — an `herr.E` adapts into a `HandledError` losslessly
  (`handledErrorFromHerr`). A handled error in Go is a handled error in the
  browser. A plain Go `error` stays unhandled.

## Testing

- A handled error's **code** is its contract — assert on `code`, never on message
  prose, which is copy and will change.
- Use `code` equality, not `instanceof`, anywhere the error may have crossed a
  process, worker, or serialisation boundary. `instanceof` is same-process only
  and breaks when a bundler loads two copies of a module.
- Assert that internal causes stay masked: a handled error wrapping a `pgError`
  must serialise that reason as `{ code: "unknown" }`.

## References

- [ADR-045](../adr/045-domain-errors-handled-boundary.md) — the boundary decision
- `packages/handled-error` — `HandledError`, `NotFoundError`, `ValidationError`
- `langwatch/src/server/app-layer/error-remediation.ts` — `tips` / `docsUrl` registry
- `specs/features/domain-error-contract.feature`
