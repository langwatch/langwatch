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
- **The four-way rule:** every dependency is one of: built inside the module
  from supplied stores; a peer `*Api` token; a deployment fact from the
  module's declared config schema (never `process.env`); or a declared supply
  token the process answers. A module never defaults its own availability.
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
- **Eventing follows the role:** the api process only sends commands;
  projections, subscribers and jobs are constructed only in the worker,
  at-least-once and per-aggregate ordered, so subscribers are idempotent.
- **Config:** modules declare, apps compose, one Zod parse per process refuses
  by name. Config is drilled as arguments (no DI container, no async context).
  Secrets are never config fields: they resolve through `@langwatch/secrets`
  (ADR-132) and are injected into the constructed collaborator.
- **Verbs (ADR-146):** `find*` returns an array (empty, never null);
  `get*`/`getBy*` returns one or throws. Don't write `T | null`; `try*` and
  `require*` are banned. Don't satisfy the linter by renaming a parser `find*`.
- **Installing a module** edits `modules/catalogue.json`, then
  `pnpm generate:modules`; never edit a composition root by hand.
- **A change the app has to grow for** means a primitive is missing: report the
  gap rather than adding code to `apps/`.
