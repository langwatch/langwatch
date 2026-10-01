# ADR-160: Internal consoles are Vite-built React, served by their Go owner

**Date:** 2026-09-28

**Status:** Accepted

## Context

A haven dev stack has five web surfaces a developer reads: the haven hub
(machine-wide), the IdP simulator, the mail sink, the design-system Storybook
and the mail room. They grew apart. The hub, the IdP simulator and the mail
sink are hand-written HTML inside Go (`html/template`, string literals, a
vanilla `ui.js`), each carrying its own copy of nearly the same paper-and-orange
tokens. The mail room is a React app on the product design system. Nothing
links them together, and a worktree has no page of its own: the hub is the only
index, and it covers the whole machine.

The Go services must keep running without Node: the simulators run in Go tests
and are bundled into the haven binary. Keeping a Vite dev server alive per
surface per worktree would cost memory the stacks already compete for.

## Decision

Every internal console is a React single-page app under `apps/<owner>-web`,
built by Vite into its Go owner's package (`web/dist`) and embedded with
`go:embed`. The Go process serves the bundle and a JSON API under `/api`; it
never renders HTML itself, beyond a one-line page saying the bundle is not
built. No Vite server runs to serve a console; `vite dev` with a proxy to the
Go API is only for working on the console itself.

| App                | Served by                               | Hostnames                                               |
| ------------------ | --------------------------------------- | ------------------------------------------------------- |
| `apps/haven-web`   | the haven daemon (`adapters/dashboard`) | `hub.langwatch.localhost`, `<slug>.langwatch.localhost` |
| `apps/idpsim-web`  | `services/idpsim`                       | `idp[.<slug>].langwatch.localhost`                      |
| `apps/mailsim-web` | `services/mailsim`                      | `mail.<slug>.langwatch.localhost`                       |
| `apps/storagesim-web`   | `services/storagesim`              | `storage.<slug>.langwatch.localhost`                    |
| `apps/llmsim-web`       | `services/llmsim`                  | `llm.<slug>.langwatch.localhost`                        |
| `apps/analyticssim-web` | `services/analyticssim`            | `analytics.<slug>.langwatch.localhost`                  |
| `apps/voicesim-web`     | `services/voicesim`                | `voice.<slug>.langwatch.localhost`                      |

All of them, plus the mail room's chrome and the Storybook manager theme, draw
from one package, `@langwatch/design-system-internal` (and read the clock through
`@langwatch/time`, as everything else does): the hub's paper look as
tokens, a stylesheet and a small set of React components. It depends on React
only; no Chakra, no product design system, no product module.

The built bundles are not committed. `make haven install` and `make service`
build them first (Nx-cached); a Go build without them serves the not-built page
and its tests use an in-memory filesystem.

## Rationale / Trade-offs

One technology for every console and one kit makes consistency structural
rather than a matter of copying tokens by hand. Serving the built bundle from
the Go process keeps the runtime cost at zero extra processes and lets the
per-worktree home answer when the stack is down, because the daemon, not the
stack, serves it. The cost is a Node build step ahead of the Go builds that
embed a console, and a JSON contract per console that the Go tests pin and the
app reads through Zod.

The internal kit is deliberately not the product design system: the consoles
are tools, not product, and the kit stays small enough that a console bundle
remains a few hundred kilobytes.

## Consequences

- `apps/` holds two kinds of thing: product processes (`main.ts` + `config.ts`)
  and internal consoles (`*-web`), which own their UI code and import nothing
  from `modules/`. ARCHITECTURE §1 records the exception.
- The mail room and Storybook keep their dev servers (they exist to author
  templates and components live) but wear the kit's chrome.
- The design brief every console follows is
  `packages/design-system-internal/README.md`.
