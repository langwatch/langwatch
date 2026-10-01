# ADR-095: haven governs tsgo — soft memory caps at spawn, a hard watchdog in the daemon

## Status

Accepted

## Context

tsgo (the native TypeScript compiler preview) is the single largest transient
memory consumer on a LangWatch dev machine. Observed on an 18 GiB laptop during
ordinary multi-agent work:

- a whole-tree `typecheck:tests` run peaking at **10.0 GiB RSS**;
- a second whole-tree run at 2.5–7.4 GiB running **concurrently** — allowed,
  because the check-queue's slot policy (ADR-090 era, `dev/scripts/check-queue.mjs`)
  bounds _concurrency_ (2 slots on this machine), not _memory_, and its sizing
  formula assumes ~3–4 GiB per run;
- long-lived `tsgo --lsp` instances of ~2.5 GiB each, one per worktree the
  tslsp daemon has ever served, parented to PID 1 and **exempt from every
  existing control by design**.

Three admission mechanisms already exist and none can make the guarantee "tsgo
never takes the machine down":

1. `haven gate` (ADR-091) sees only tool calls from hooked agent sessions.
2. `check-queue.mjs` sees only spawns through the pnpm scripts and the shims
   installed into `platform/app/node_modules/.bin` — `sdks/typescript`'s tsgo
   binary is raw, and `--lsp`/`--watch` are exempt on purpose.
3. The two count against **separate ledgers** (haven's registry vs the queue's
   tmp directory), so each admits its own runs blind to the other's.

Gating spawn paths is whack-a-mole: every new package, editor, or daemon that
spawns tsgo reopens the hole.

One more fact shapes the design: **tsgo is a Go binary**, so `GOMEMLIMIT`
gives a soft ceiling — the runtime collects harder to stay under the limit
instead of ballooning, degrading to "slower" rather than "10 GiB resident".
A soft cap cannot be the whole answer (a live heap genuinely above the limit
still grows, now with heavy GC), but it makes the common case self-limiting
with no process ever killed.

## Decision

Two layers, one guarantee. The watchdog is the guarantee; the soft cap is what
makes the watchdog almost never fire.

### 1. `GOMEMLIMIT` at spawn (soft cap)

Every spawn path we own sets `GOMEMLIMIT` on tsgo unless the operator already
did: the check-queue shim path sizes it from machine RAM (half of total,
clamped to [4 GiB, 10 GiB]). Runs degrade to more GC instead of more resident
memory. Explicit `GOMEMLIMIT` in the environment always wins.

### 2. tsgo watchdog on the daemon tick (hard backstop)

The haven daemon's existing 10-second monitor tick samples every tsgo process
on the machine — however it was spawned — and applies policy:

- **Per-run hard ceiling** (`HAVEN_TSGO_RUN_MAX_RSS_MB`, default 12 GiB): a
  whole-tree run above it is runaway and is killed.
- **LSP ceiling** (`HAVEN_TSGO_LSP_MAX_RSS_MB`, default 4 GiB): an `--lsp`
  instance above it is killed — LSPs respawn lazily on next use, so eviction
  costs a reconnect, not work.
- **LSP idle eviction** (`HAVEN_TSGO_LSP_IDLE_TTL`, default 45m): an LSP whose
  CPU clock has not moved for the TTL is evicted. This is what stops the
  one-2.5-GiB-LSP-per-worktree accumulation.
- **Aggregate budget** (`HAVEN_TSGO_TOTAL_BUDGET_MB`, default two thirds of
  RAM, never below the per-run ceiling): when all tsgo together exceed it,
  the watchdog reclaims in order —
  idle LSPs first, then the **youngest** whole-tree run (the oldest is closest
  to finishing) — until under budget.
- Setting a knob to 0 disables that rule; `HAVEN_TSGO_RUN_MAX_RSS_MB=0`
  disables the watchdog entirely.

Classification is deliberately crude: `--lsp` in the argv is an LSP, anything
else is a run. Single-file checks are tiny and never cross any threshold, so
distinguishing them buys nothing.

### 3. A generic process watch feeding the local Grafana

The sampler is not tsgo-specific. Every tick classifies the machine's
dev-tooling processes — tsgo (run/lsp), gopls, biome, vitest workers, node,
bun, and claude agents — and ships per-class footprints to the local
observability stack over OTLP (`adapters/procmetrics`): resident set, process
count, and oldest-process age by class and role, plus a counter of governor
kills by reason. Exports are fire-and-forget: with the stack down they are
dropped silently, never buffered and never logged into a spam stream.

Only tsgo carries kill limits. node and claude are the user's own work and are
observe-only by principle; gopls, biome and vitest are observe-only until the
recorded history shows a class actually misbehaving — which is exactly the
decision this data exists to inform ("did the Prisma 7 upgrade shrink
typecheck?", "how many vitest workers really run at once?").

### Killing is in scope here, unlike ADR-090

ADR-090's governor demotes and never kills, because stacks are user work and
killing one loses it. A tsgo process is **regenerable tooling** — killing a
typecheck loses a check, killing an LSP loses a reconnect — the same class as
the vitest orphans the daemon already sweeps. The watchdog kills only processes
whose command line resolves to a tsgo binary; it can never touch a stack, an
agent, or anything else.

### Observability

Every kill is logged with the reason, class, RSS and age, and counted in the
kill metric by reason — so "did the Prisma 7 upgrade make types cheaper" is
answered from the recorded per-class footprint history rather than a hunch.

## Amendment (2026-08-25): the compiler answers to two names

TypeScript 7 shipped as the `typescript` package and **renamed the native
binary from `tsgo` to `tsc`** (`lib/getExePath.js` picks the name from the
package it was published in; `lib/tsc.js` then `execve()`s it, so the live
process image IS the compiler and its argv[0] ends in `/tsc`). The governor
selected on `binaryBase(command) == "tsgo"`, so on a machine that had moved to
typescript@7 it selected **nothing**: no per-run ceiling, no combined budget,
no runaway reclamation, and the compiler did not even reach the dev-tooling
dashboards, because it matched no watched class either.

The selection rule is now name-neutral — `domain.IsTypeScriptCompilerCommand`
accepts `tsc` and `tsgo`, still matched on the binary's base name and never on
the args — and both land in the **same** watched class, so one compiler is one
budget however it was installed. Nothing above changes: the knobs keep their
`HAVEN_TSGO_*` names, the class attribute and the reap Kind stay spelled
`tsgo`, and a machine still running the preview package (or a local build of
the TypeScript repo, which still produces `tsgo`) behaves exactly as before.
Splitting the two names into two classes was rejected for the same reason:
each half of a machine's compilers would then be weighed against the whole
budget, and the recorded history would be cut in two.

`haven gate` gained the compiler by binary name rather than by substring —
`tsc` is a substring of `tsconfig.json`, and a gate that queues `cat` is its
own outage. See ADR-099 for the compiler move itself.

## Consequences

- No spawn path can take the machine down: unshimmed binaries, editors and
  daemons are all inside the watchdog's reach, because it watches processes,
  not spawns.
- A run killed by the aggregate budget fails visibly (the queue reports the
  killed child); the daemon log carries the reason. This is judged better than
  the alternative — the machine paging until the OS or the operator kills
  something less regenerable.
- A genuinely-larger future typecheck (live heap above the soft cap) gets
  slower before it gets killed; raising the knobs is a one-line env change.
- The queue's decisions have since moved into haven: `haven slot run` gates
  whole-repo checks on the same flock semaphore `haven typecheck` holds, and
  `check-queue.mjs` delegates to it whenever the haven binary is installed —
  one counter, one implementation, with the JS queue kept only as the
  fallback for machines without haven (see
  `specs/setup/check-slots.feature`, "The queue lives inside haven"). The
  watchdog remains the guarantee either way: it makes the machine safe
  regardless of which admission path a run took.

## Related

- ADR-090 — machine-wide resource governance (pressure, demotion, no kills for stacks)
- ADR-091 — haven gate (agent-session admission)
- ADR-099 — TypeScript 7 is the compiler (the rename this governor was amended for)
- `specs/setup/haven-tsgo-governor.feature` — the behavioural contract
- `specs/setup/check-slots.feature` — the whole-tree check queue this backstops
