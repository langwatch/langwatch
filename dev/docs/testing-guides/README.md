# Trigger-outbox stack — testing guides

Five stacked PRs move custom-graph alerts, threshold triggers, and
analytics reads off the K8s cron + `trace_summaries` re-scans and onto
an event-sourced, transactional-outbox path. Each PR in the stack has a
matching guide below for human QA + on-call to click through, verify
behaviour, and know which flag flips old vs new flow.

Guides are written for someone doing the QA — real button labels, real
menu paths, real URLs. If something doesn't match what's in front of
you, the guide is wrong; open a ticket, don't fix silently in prod.

## Stack order

The PRs are stacked in this order. Each one assumes the previous ones
have landed; regressions frequently cross PR boundaries, so run the
guides in order on any pre-prod verification pass.

| # | PR | Branch | Ships |
|---|----|--------|-------|
| 1 | [#4498](./pr-4498-trigger-outbox-dispatch.md) | `feat/trigger-outbox-dispatch` → `main` | Transactional outbox substrate, per-trigger cadence + debounce, Liquid templating, email abuse protections (per-project daily cap, per-recipient hourly cap, suppressions, unsubscribe deep links), ADR-035 persist-class debounce. |
| 2 | [#5012](./pr-5012-trace-analytics-foundation.md) | `pr/03-trace-analytics-foundation` | `trace_analytics` slim + `trace_analytics_rollup` ClickHouse tables (ADR-034 Phases 0-3.5). App-layer read routing behind `release_event_sourced_analytics_read`. Optional tripwire behind `release_event_sourced_analytics_read_tripwire`. |
| 3 | [#5013](./pr-5013-heartbeat-graph-triggers.md) | `pr/04-heartbeat-graph-triggers` | ADR-033 outbox heartbeat primitive + ADR-034 Phase 5 graph triggers via outbox reactor + heartbeat absence-resolve. Flipped per project by `release_es_graph_triggers_firing`; cron coexists for un-flagged projects. |
| 4 | [#5014](./pr-5014-eval-write-side-aggregates.md) | `pr/05-eval-and-write-side-aggregates` | ADR-034 Phase 6 (`evaluation_analytics` slim + rollup + reactor) and Phase 7 (sim/exp/suite write-side only, no reads). The **same** `release_event_sourced_analytics_read` flag from PR2 now covers eval-source metrics too. `release_es_graph_triggers_firing` now also gates eval graph triggers. |
| 5 | [#5015](./pr-5015-graph-alerts-ui-templates.md) | `pr/06-graph-alerts-ui-templates` | ADR-034 Phases 5.1 / 5.2 / 8 / 8.1: graph-threshold alerts inside the automations drawer, dashboard "Add alert" button repointed to the same drawer, graph alerts dispatched through Liquid templates. No new flag — depends on `release_es_graph_triggers_firing` from PR3 being ON to see the new dispatch path fire. |

## Flag summary

Read the guide for each PR for the full behaviour and rollback plan.
Registered in `langwatch/src/server/featureFlag/registry.ts`; verified
strings only, no invented flags.

| Flag | Default | Owns | Introduced by |
|------|---------|------|---------------|
| _(none — outbox is always-on)_ | — | PR1 dispatch, cadence, debounce, email caps | PR #4498 |
| `release_event_sourced_analytics_read` | `false` | Route analytics `getTimeseries` reads to slim / rollup tables (trace-source PR2; eval-source PR4). | PR #5012 |
| `release_event_sourced_analytics_read_tripwire` | `false` | Run routed + legacy queries in parallel and log divergence. Requires the read flag also ON. | PR #5012 |
| `release_es_graph_triggers_firing` | `false` | Move a project's custom-graph threshold triggers off the K8s cron onto the outbox + heartbeat path. Also gates eval-source graph triggers in PR4. Also gates the new Liquid graph-alert dispatch from PR5. | PR #5013 |

Env override for local testing works for any registered flag:

```bash
FEATURE_FLAG_FORCE_ENABLE=release_es_graph_triggers_firing pnpm dev
```

## Common regression traps across the stack

Repeated below in each guide with local specifics; listed once here so
you know to watch for them everywhere:

- **Outbox runtime wiring.** `presets.ts` builds the outbox after
  `new EventSourcing(...)` and one-shot `attachOutbox()`s it in. If a
  worker starts and no outbox is attached, every settle / cadence /
  graphEval enqueue silently fails closed. Watch worker boot logs for
  `outbox runtime attached` and the corresponding warn if it's missing.
- **Filter payload type.** `filters` on the `Trigger` row must be a JSON
  object (`{}`), not the string `"{}"`. The graph-alert builder is the
  single source of truth; both create + update paths route through it.
- **Case-insensitive `Alert:` prefix.** Naming a graph alert
  `alert: cost spike` must produce `Alert: cost spike`, not
  `Alert: alert: cost spike`. Same for update.
- **ClickHouse TTL sentinel.** Migrations 00037-00046 use the
  `IF(_retention_days > 0, …, '2106-01-01')` form. If a rollup / slim
  table's TTL clause references a bare `INTERVAL _retention_days DAY`,
  rows for indefinite-retention projects (`_retention_days = 0`) get
  reaped on the next merge — hard regression, catch it in the DDL before
  the first insert.

## Local dev prep

Every guide assumes:

1. `langwatch/.env` is populated (see `langwatch/.env.example`). `BASE_HOST`
   must be set — the outbox dispatcher throws at setup if it's unset because
   trigger emails render broken deep links.
2. `pnpm install` has run.
3. `pnpm start:prepare:files` has run at least once (regenerates Prisma,
   Zod, langevals types).
4. `make quickstart all-local` (or the preset the guide names) is up
   and healthy.
5. `pnpm dev` is running from `langwatch/`. Ports collide? paste the
   `PORT=5570 pnpm dev` command that `check-ports.sh` prints; do not
   invent your own process-tree walker.
