---
paths:
  - "modules/*/contract/**"
  - "modules/*/process/**"
  - "enterprise/modules/*/contract/**"
  - "enterprise/modules/*/process/**"
  - "apps/api/**"
  - "apps/worker/**"
  - "apps/tasks/**"
  - "modules/catalogue.json"
---

# Module contract and process halves

Load the `backend` skill for anything beyond a small edit here. The authority is
`dev/docs/ARCHITECTURE.md` (§3 a module, §4 a process, §8 transports, §9
eventing); all of the below is lint-enforced.

- **Dependency direction:** apps → `*-process`/`*-browser` → `*-contract`.
  Process never imports browser; contract imports no framework. Another module
  imports only the owner's contract and calls its `*Api` token.
- **The contract** holds Zod schemas with `infer`, portable types,
  `HandledError` subclasses with stable codes, tRPC declarations, the module's
  config schema, and the `*Api` interface + token (`<name>.api.ts`).
- **Process layout** (filenames: `packages/oxlint-rules/grammar/feature-layout-policy.mjs`):
  `services/` one class per entity, `static create`, private constructor ·
  `repositories/` interfaces on top, `prisma/` and `memory/` backends below, a
  registry offering both · `channels/` messages to anything unowned (bus,
  vendor HTTP, queue, email, SSE), each with a memory twin · `eventing/` the
  `definePipeline` pipeline and what it names · `transport/` declarations only ·
  `rules/` pure functions. No `utils/`, `ports/`, `adapters/`, `lib/`,
  `helpers/`, `domain/`.
- **No raw clients in module code.** Prisma, ClickHouse, Redis and object
  storage arrive only as repositories and channels built from a registry or
  channel factory. Only `repositories/prisma/**` names Prisma. Uploads go to a
  signed URL and are attached by reference; no module buffers upload bytes
  (ADR-158).
- **The four-way rule (§3.3):** every dependency is one of: a repository or
  channel built by the container from the module's own registry; a peer `*Api`
  token in `static dependencies`; a deployment fact from the module's declared
  config slice or secret handle (never `process.env`); or an availability the
  module decides from its own config and secrets, refusing by name when off.
  There are no members, no supply tokens and no `.provide` (§15).
- **Transports declare, never implement.** Handlers receive
  `{ input, app, actor, scope, signal }`, call one API operation, and return a
  plain value or throw. No `c.json`, status branches, error envelopes or
  hand-rolled refusals; a thrown `HandledError` is the refusal.
- **Authorization is declared on the route.** `.withPermission(permission)`,
  with a target when it is asked somewhere other than the credential's scope
  (`{ at: "route", param }`, and on the key door `{ at: "grants" }` or
  `{ at: "organization" }`). `anyAuthenticated`, `deferredScope` and
  `publicRoute` are for routes that ask no permission at all; none of them may
  be followed by a permission check in a middleware fact, a handler or an
  `*Api` operation. A case the declaration cannot express is a gap in
  `packages/api` and the door auth binds: extend those. What stays in a service
  is the part that needs the loaded row (the scopes a resource lives in).
- **Analytics is nurturing's.** PostHog, Customer.io and every product
  analytics or lifecycle event are sent by `enterprise/modules/nurturing`. Any
  other module records a fact event from its service and stops there; nurturing
  subscribes with `.withPeerSubscriber`. Adding an analytics channel, client or
  key to another module is a defect.
- **Eventing follows the role (§9):** the api process only sends commands;
  projections, subscribers and process managers run in the worker only,
  at-least-once and per-aggregate ordered, so subscribers are idempotent.
  Background and calendar work is a scheduled process manager, never a job.
- **Config (§6):** declared at its owner, in the contract's `<name>.config.ts`
  (`Config.define` leaves, `Secret.load` handles); the module class attaches
  them as `static readonly config`/`secrets`. The parse is generated from the
  installed list and refuses by name; apps hold no module config. Secrets are
  never config fields: `create()` and the registries resolve them through
  `secrets.into(...)` (`@langwatch/secrets`, ADR-132). No async context.
- **Verbs (ADR-146, §15):** `find*` returns an array (empty, never null);
  `get*`/`getBy*` returns one or throws; `list*` returns a page. Don't write
  `T | null`; `try*` and
  `require*` are banned. Don't satisfy the linter by renaming a parser `find*`.
- **Installing a module** edits `modules/catalogue.json`, then
  `pnpm generate:modules`; never edit a composition root by hand.
- **A change the app has to grow for** means a primitive is missing: report the
  gap rather than adding code to `apps/`.
