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
throw new EvaluationNotFoundError(evaluationId);

// ✅ known + actionable, wrapping an internal cause that stays masked
throw new EvaluationNotFoundError(evaluationId, { reasons: [pgError] });

// ❌ unknown cause dressed as handled — caller can't act on it
throw new DatabaseError("database_error", pgError.message);

// ✅ the same failure, correctly
throw pgError; // degrades to "unknown" at the boundary, logged with the trace id
```

## Authoring one

A handled error is three edits, not one, and the middle one is the one people
forget:

1. **The subclass**, in a per-domain `errors.ts` next to the code that throws
   it, with a stable `code`.
2. **The code**, added to `APP_ERROR_CODES` in
   `packages/handled-error/src/app-codes.ts` — **kept sorted**, because a
   test asserts the ordering so the next insertion lands where the reader looks
   for it.
3. **The customer copy**, as that code's entry in
   `packages/handled-error/src/presentation.ts`. The registry is
   exhaustive over the enumerated codes, so step 2 without step 3 fails
   `pnpm typecheck`, and step 1 without step 2 fails
   `errors/__tests__/codes.unit.test.ts`. Both directions are checked: a code in
   the list that nothing raises is dead copy and fails too.

`packages/features/evaluation/contract/src/evaluation-execution.errors.ts` is a
worked example:

```ts
export class EvaluationNotFoundError extends NotFoundError {
  declare readonly code: "evaluation_not_found";

  constructor(evaluationId: string, options: { reasons?: readonly Error[] } = {}) {
    super("evaluation_not_found", "Evaluation", evaluationId, {
      meta: { evaluationId },
      ...remediation("evaluation_not_found"),
      ...options,
    });
    this.name = "EvaluationNotFoundError";
  }
}
```

Each field earns its place:

| field     | rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `code`    | Stable, `snake_case`, unique platform-wide. This is the wire discriminant, the key every client explainer is written against, **and the literal wire message on tRPC and SSE** — renaming one is a breaking change.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `message` | **Write it so a customer could read it.** It is server-_first_ — logs, OTel and exception capture are its main readers — but it is not private: the REST boundary puts it straight in the response body (`error-handler.ts` sends `{ error: code, message }`, pinned by `error-handler.unit.test.ts`). Nothing on a handled error is sensitive; that is what "handled" means. So no env vars, no internal hostnames, no service names — those go in the log line next to the throw, where they belong. This is _not_ the app's UI copy either: that lives in the client presentation registry, keyed by `code`. See "Where the words come from" below. |
| `fault`   | Who can act. Drives **log level and alerting**, not UI. Defaults to `customer` — so any subclass with a 5xx status must set `platform` or `provider` explicitly, or a real incident logs as routine noise.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `meta`    | Structured context the **client can actually use**. Not a debug dump. If no UI reads a field, it does not belong here — put it in the log instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `tips`    | Short, actionable, imperative. Written for an agent driving the API/CLI/MCP with no UI to fall back on. In the app they are a _fallback_, shown only for a code the presentation registry has no description for — see "Surfacing one to the user".                                                                                                                                                                                                                                                                                                                                                                                                    |
| `docsUrl` | Canonical `docs.langwatch.ai` link, built from a static path in `error-remediation.ts` — never interpolated from request data. The client renders it as an `href` and validates the origin first (`safeDocsUrl` in `readHandledError.ts`), dropping anything that isn't a link to the docs site — because a relayed Go error's `docs_url` is parsed from an upstream response body.                                                                                                                                                                                                                                                                    |
| `reasons` | The cause chain. Non-handled links serialise as `{ code: "unknown" }` automatically — safe to pass an internal error here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

`tips` and `docsUrl` are centralised in
`packages/handled-error/src/remediation.ts`. Add remediation copy there,
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

|                                        | source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| What a customer reads **in the app**   | The **client presentation registry**, keyed by `code` — `packages/handled-error/src/presentation.ts`                                                                                                                                                                                                                                                                                                                                                                                                               |
| `HandledError.message`                 | Logs, OTel, exception capture — **and the REST response body**. Customer-safe by rule, never the app's UI copy                                                                                                                                                                                                                                                                                                                                                                                                     |
| The wire `message` field               | **Per transport.** tRPC collapses it to the `code` ([#5984](https://github.com/langwatch/langwatch/pull/5984)). REST sends `{ error: code, message }`, so the sentence rides _alongside_ the code. SSE sends the code with the serialised payload beside it                                                                                                                                                                                                                                                        |
| Server-authored dynamic prose          | `meta.message`, an explicit opt-in — mirrors Go, where free text appears only when a caller sets `Meta["message"]`. Almost always prose _we_ wrote; the exception is a third party's own sentence deliberately relayed because it is the whole answer (a model provider's "your credit balance is too low" — `llm_upstream_error`). Either way a registry entry that renders it passes it through `safeProse` first, and the codes allowed to render it at all are named one by one in `presentation.unit.test.ts` |
| What a consumer with no registry reads | `meta.message` → `message` → `code`, in that order — the CLI (`packages/langy/src/cards/handled-error.ts`) and the Python SDK (`extract_api_error_detail`) both implement it                                                                                                                                                                                                                                                                                                                                       |

Handled-error messages were leaking env vars and internal hostnames to browsers.
Two things closed that, and only one of them is on the wire: tRPC now sends the
stable code where a message is required, and — the durable half — a handled
error's `message` is _written_ customer-safe in the first place, because REST
does ship it. The consequence for app code: **`error.message` on a tRPC error is
a code slug, not a sentence.** Rendering it directly puts `validation_error` in
front of a customer.

That last row is a deliberate ordering, not a shrug. A bare code slug is an ugly
last resort but a _specific_ one: `project_slug_taken` tells a CLI user which
thing went wrong, where "Failed to save." tells them nothing at all. Degrade
towards the specific. The app can do better than the slug because it has a
registry — see the fault-based fallback below — but a consumer without one shows
the code rather than inventing a generic sentence over the top of it.

## Surfacing one to the user

The server emits the typed fact; the client decides presentation. Principles,
in order of how often they are violated:

1. **Never toast a raw `error.message` yourself.** For a handled error on tRPC it
   is the code slug; for an unhandled one it is unsafe. Call `showErrorToast` and let
   it decide — it reads the handled payload, renders from the registry, and
   falls back to the generic unknown state. The one narrow exception is handled
   _inside_ that helper and described under "The 4xx authored-prose channel"
   below; it is not something to reimplement at a call site.

   `logic/__tests__/noRawErrorToasts.unit.test.ts` scans the tree for it. It is
   now the only guard: an author-time GritQL plugin used to run alongside it and
   went with the linter that hosted it (see
   `packages/architecture-lint/adrs/003-unified-oxc-toolchain.md`). The scanner
   was always the authority on what may ship, and it catches everything the
   plugin did except one shape — a copy object built outside the toast call's
   own argument list, `toaster.create(buildToast({ description: error.message
}))`, which the scanner attributes to `buildToast`. Rewriting the plugin as
   an oxlint JavaScript plugin is open follow-up work.

   The scanner works by derivation, so it will occasionally flag a value that
   only _looks_ message-derived — a string that went through a sanitiser, or a
   local parser's message that never crossed the wire. Mark that one line
   `// no-raw-error-toast-ok` with a reason. Prefer the marker to the guard's
   file-level allowlist: an exemption entry blinds the guard to the whole file.

   **The marker goes where the value is _used_, not where it is derived.** The
   scanner tracks taint through locals to a fixpoint — `const message = e
instanceof Error ? e.message : "…"` taints `message`, and so does a second
   local assigned from it — but it only ever reports the copy slot the tainted
   value reaches. Suppression is matched against the line of that slot's key
   (`title`, `description` or `fallbackTitle`), so a marker parked on the
   assignment suppresses nothing:

   ```ts
   const friendly = e instanceof Error ? e.message : "Couldn't save";
   toaster.create({
     description: friendly, // no-raw-error-toast-ok — sanitised local, never on the wire
     type: "error",
   });
   ```

   When the formatter wraps a long value onto its own line, the marker may sit
   anywhere from the key's line to the line the value ends on — so both the
   compact and the wrapped spelling work.

   **Write the marker _inside_ the call or element it exempts.** The scanner
   matches it against the line of the copy slot's key, and writing it inside the
   construct is what keeps it on that line through a reformat. Either spelling
   is honoured:

   ```tsx
   toaster.create({
     description: friendly, // no-raw-error-toast-ok — sanitised local
     type: "error",
   });

   <Alert.Description>
     {parseFailure /* no-raw-error-toast-ok — local parser, never on the wire */}
   </Alert.Description>;
   ```

   There is no blanket escape hatch. The scanner has a file-level allowlist,
   which blinds it to the whole file; use the per-line marker instead.

2. **Title and description both come from the `code`**, not the server. The
   registry owns the customer-facing copy. A code the registry does not know
   degrades to the humanised code itself (`dataset_import_stalled` → "Dataset
   import stalled") — specific, and quotable to support — because a client can
   be older than the service that minted the code. **The caller's
   `fallbackTitle` outranks that**, though: `showErrorToast` and
   `<HandledErrorAlert>` only reach for the humanised code when the call site
   supplied no fallback, because "Couldn't create project" at least names the
   action, where a slug names only the failure. Registry copy is the one thing
   that beats a fallback, since it describes this exact failure. So on the path
   this doc tells you to write — always pass a `fallbackTitle` — the humanised
   code is a _last_ resort, not the usual unregistered-code headline. The
   `fault`-based fallback (customer → "Check your input", platform → "Something
   went wrong on our end", provider → "A connected service didn't respond") is
   reached only when there is no code at all. Those three are distinct on
   purpose — a provider fault is a _third party_ that didn't answer, and telling
   the customer it was us is both wrong and less actionable.
3. **`docsUrl` is always offered; a `tip` shows unless it repeats the
   description.** `ErrorActions` renders the docs link whenever there is one.
   Tips are the server's remediation, written for agents driving the
   API/CLI/MCP; the registry description is written for this surface. Where the
   two say the same thing, the registry wins and the tip is dropped —
   `query_timeout`'s description and its first tip both say "narrow the time
   range", so showing both makes the surface repeat itself. Where a tip says
   something the description does not, it is kept: dropping every tip whenever
   the registry had _any_ description threw away the escalation path on nearly
   every error, and `clickhouse_unavailable`'s "check the status page or
   contact support" never once reached a customer.

   `resolveErrorCopy` (`logic/resolveErrorCopy.ts`) applies that comparison
   once, on a normalised form, and both surfaces render its output:
   `<HandledErrorAlert>` lists every remaining tip, `showErrorToast` folds in
   the first. Pinned by `logic/__tests__/showErrorToast.unit.test.ts` and
   `components/__tests__/HandledErrorAlert.integration.test.tsx`.

4. **Never render raw `meta` or the reason chain in the UI.** They are for agents
   and logs. A customer sees a title, a description (registry copy, plus any
   tip that adds to it), a docs link, and a copyable error id. The
   registry may read a _named_ `meta` field where its entry declares the shape
   and the value is something the customer supplied or chose — a filter field
   they typed, a notification channel they picked. That is the whole of the
   exception: a registry entry reads `meta.field`, never `error.meta`.
5. **Validation errors belong on the form, not in a toast.** Map
   `meta.fieldErrors` onto the offending fields and make it visually obvious the
   server rejected the submission.
6. **Unhandled errors get one calm generic state** plus the copyable error id —
   never the raw text.

The reader, the code list and the registry live in `@langwatch/handled-error`
(`/read-handled-error`, `/app-codes`, `/presentation`); `apps/ui` composes them
into the surfaces below, and `@langwatch/trace-web` exports its own from
`ui/sections/errors`:

| export                                          | use it for                                                                                                                                                                                                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `showErrorToast`                                | The only sanctioned error toast. Absorbs the global-handler dedup check.                                                                                                                                                                                    |
| `<HandledErrorAlert>`                           | The inline counterpart. A toast is for something that just happened; an alert is for something that is still true.                                                                                                                                          |
| `applyHandledErrorToForm` + `<FormServerError>` | A rejected submit. See the warning below — they ship as a pair.                                                                                                                                                                                             |
| `describeError`                                 | Slots that can only take a string: a `title=` tooltip, an `aria-label`, a state field typed `string`. It loses the tips, the docs link and the error id, so prefer a component wherever one can be rendered.                                                |
| `explainSerializedError`                        | A handled error that arrived already-structured on an event payload (a `target_result.domainError`) rather than off a transport envelope.                                                                                                                   |
| `readHandledError`                              | Lifting the payload when you need to branch on `code` yourself.                                                                                                                                                                                             |
| `resolveErrorCopy`                              | Title, description, supplemental tips, docs link and trace id, resolved once, for a surface that renders its own chrome. `showErrorToast`, `<HandledErrorAlert>` and `describeError` are all built on it — reach for it only when none of those three fits. |

Do not hand-roll `error.data?.error` at a call site — three separate ad-hoc
readers is how this got inconsistent the first time. In particular, do not
hand-roll the read → explain → fall back sequence: it has a third branch
(below) that is easy to miss, and every site that missed it silently downgraded
its own copy.

### The 4xx authored-prose channel

`showErrorToast`, `<HandledErrorAlert>` and `describeError` all branch three
ways, not two: handled → registry, **plain non-5xx with an authored message →
that message**, everything else → the generic unknown state.

The middle branch exists because #5984 collapsed the wire message to the code
for _handled_ errors but deliberately left a plain non-5xx `TRPCError`'s message
alone. Several hundred procedures throw one with real copy in it — "You've
already used this invite", "That name is taken" — and replacing those with
"we've been notified" tells the user to wait for something that will never
change. That is a worse failure than the slug it would be avoiding.

**Whether a message is authored is decided at the boundary, not guessed at by
the client.** `errorFormatter` in `src/server/api/trpc.ts` sets
`data.authored`, and it is the only place that can: the test needs `cause`,
which never crosses the wire. The rule it encodes: a message counts as authored
only when the **procedure supplied it itself** — not when tRPC defaulted it to
the code name, and not when it was inherited from a `cause`. That excludes the
two accidents that otherwise reach a customer:

```ts
new TRPCError({ code: "NOT_FOUND" }); // message IS "NOT_FOUND"
new TRPCError({ code: "BAD_REQUEST", cause: err }); // message is err's
```

The first put a shouted code slug in front of a customer; the second dragged a
driver diagnostic through the same hole at 4xx that #5984 closed at 5xx. An
earlier version of this tried to tell them apart by sniffing the message for
machine vocabulary, which is a guess — and a guess that silently ate real copy
("Select a template from the list" looked like SQL).

Read the predicate in `trpc.ts` before relying on its exact shape. Two details
are easy to state wrong:

- **The status test is not "non-5xx".** The boundary only excludes
  `INTERNAL_SERVER_ERROR` (on the error, or on the shape's `data.code`). The
  `>= 500` test is a _second_, client-side gate in `readAuthoredMessage`.
- **Carrying a `cause` is not by itself disqualifying.** `isInheritedFromCause`
  walks the cause chain and compares messages, so what gets rejected is a
  message _equal to_ something in that chain — the tell that tRPC copied it up
  rather than the procedure writing it. A procedure that writes real copy **and**
  attaches a `cause` for the logs keeps its copy. An earlier version disqualified
  any error with a `cause` at all, which was safe but ate deliberate prose.

`readAuthoredMessage` still applies a second layer on top of the flag (length
cap, SCREAMING_CASE, and a deliberately conservative machine-prose pattern),
because the cost of being wrong is a Prisma string in a toast. Anything that
pattern rejects must be something no product person would type.

None of this is a substitute for throwing a `HandledError` — **if you can name
the failure, name it** and write its copy in the registry. The channel exists
to stop the migration destroying copy that was already good, not to be a place
to put new copy.

### `applyHandledErrorToForm` and `<FormServerError>` ship together

The bridge claims an error — returning `true` so the caller skips its toast —
only for complaints it can actually put on screen. That check is not something
it can make on its own for form-level complaints (`meta.formErrors`): they go to
`root.serverError`, and `setError` succeeds whether or not anything renders it.

So it takes `hasFormErrorSlot`, defaulting to `false`. Pass `true` **only** if
the form renders `<FormServerError form={form} />`. Get this wrong in the
optimistic direction and the user presses Save and nothing happens at all — no
toast, no field text, nothing — which is strictly worse than the raw-message
toast this module replaced.

The same trap applies per field. The bridge only claims a field it can satisfy
itself this form actually renders an input for — a bare key check is not enough,
because zod's `flatten()` collapses a nested path to its head, so `version` looks
owned while nothing is registered against it and `shouldFocus` finds no ref. Even
so, it cannot see whether you render an _error slot_ beside that input. If a
field is in the schema but has no visible input — the prompt forms collect
`handle` in a separate dialog — don't route validation errors to that form at
all.

**There is a third outcome the boolean hides.** On a _partial_ match — the error
names four fields and this form owns two — the bridge marks the two it owns
**and still returns `false`**. So the user sees red fields _and_ the caller's
toast, deliberately: the half this form cannot show must not vanish. It also
skips the focus jump in that case, because yanking focus into a field while a
toast explains a different problem reads as two things fighting for attention.
Don't write a call site that assumes "returned `false`" means "touched
nothing".

## Don't constrain a `z.record` key schema — refine the keys instead

`ValidationError.fromZodError` sends the caller `zodError.flatten()`. Under
zod 4 a key schema's refusal is reported as an `invalid_key` issue with the
real one nested inside it, and `flatten()` only reads the outer message. So

```ts
z.record(z.string().max(256), valueSchema); // ✗
```

reaches the customer as `fieldErrors: { parameters: ["Invalid key in record"] }`
— which names neither the offending key nor what was wrong with it, and says
"record", which is our storage rather than their vocabulary. It also breaks
tests that assert the issue `code`, because the `too_big` they expect is one
level down.

Put the constraint in a refinement, where the issue is yours to shape:

```ts
z.record(z.string(), valueSchema).superRefine((values, ctx) => {
  // ✓
  for (const name of Object.keys(values)) {
    if (name.length > MAX) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        origin: "string",
        maximum: MAX,
        inclusive: true,
        path: [name],
        message: `A parameter name may be at most ${MAX} characters`,
      });
    }
  }
});
```

The `path` carries the offending key, the `maximum` is readable without
parsing prose, and the message is the one the customer sees.

This applies wherever a caller can choose the keys. A record whose keys are
machine-generated — array indices in a serialised wire format, say — is not
member input, and constraining its key schema is fine.

## Non-tRPC transports

Not every transport carries the identical shape yet. Know which one you are on:

- **SSE** (`src/server/routes/sse.ts`) — the error frame is
  `{ type: "error", message: <code>, error: <serialised handled error> }`. The
  payload key is `error`, not `domainError`. A non-handled stream failure
  degrades to the generic unknown message — never raw error text onto an
  already-200 stream.
- **The Langy and studio stream frames are still uncoded.** The studio's
  `src/app/api/workflows/post_event/post-event.ts` emits
  `{ type: "error", payload: { message } }`, and the Langy chat transport emits
  `{ type: "error", errorText }` — a raw string either way, with no structured
  payload for a client to key copy off. ADR-045 §6 says they should carry the
  serialised shape; they do not yet, so don't cite them as examples of the
  contract, and don't assume a code is available when consuming them.
- **Hono REST** — throw the `HandledError`; `createServiceApp`'s `onError`
  serialises it to `{ error: code, message, ...meta, tips?, docsUrl?, fault?,
reasons? }`. Note that `message` is the error's own sentence here, not the
  code — which is why it has to be written customer-safe. Hand-rolling
  `c.json({ error: "..." }, { status })` is a code smell and bypasses the whole
  contract.
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
- `packages/handled-error/src/presentation.ts` — **the presentation
  registry**: every customer-facing title and description, keyed by `code`
- `packages/handled-error/src/app-codes.ts` — `APP_ERROR_CODES`, the
  enumerated app codes the registry must be exhaustive over
- `packages/handled-error/src/remediation.ts` — `tips` / `docsUrl` registry
- `packages/api/src/rest/canonical-family-error-handler.ts` — the REST boundary, and
  the reason `message` must be customer-safe
- `specs/features/domain-error-contract.feature` — the boundary contract
- `specs/features/handled-error-presentation.feature` — what the customer reads
