---
name: haven-logs
description: "Read a haven stack's own logs, errors, traces, metrics and profiles: `haven logs`, `errors`, `obs traces`, `obs query`, `obs metrics`, `obs profiles` and the `status` stores and jobs sections, with `--agent` for plain output. Use when someone says 'haven logs', 'read the api log', 'tail the log', 'haven logs -f', 'haven traces', 'haven metrics', 'haven query', 'haven stores', 'haven jobs', 'what failed in the stack', 'haven errors', 'haven obs traces', 'slow traces of the stack', 'logs for a trace', 'traceql', 'logql', 'promql', 'haven obs query', 'haven obs metrics', 'what is burning CPU', 'is the database at its limit', or 'what did the up run'. These are the stack's own OTel data, not product traces."
user-invocable: true
argument-hint: "[logs <service> --since 10m --level warn --agent | errors | obs traces | obs query traceql '<q>']"
---

# haven logs, traces and the stack's own telemetry

This is the stack's OTel telemetry (Tempo, Loki, Prometheus, Pyroscope), not product traces.
Every read is filtered to this worktree and prints a Grafana deep link (`grafana` in `--json`).
`--agent` (or `HAVEN_AGENT=1`) makes output plain: no colour, no redraws.

## Reads

| Need                                  | Command                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------- |
| One service's log                     | `haven logs api --since 10m --agent`                                    |
| Only warnings and worse               | `haven logs api --level warn --agent` (`error` too)                     |
| Follow live                           | `haven logs api -f`                                                     |
| Grep the captured read                | `haven logs api --grep boom`                                            |
| Full info/debug stream from Loki      | `haven logs api --loki --since 1h --grep timeout`                       |
| Logs for one trace                    | `haven logs --trace <trace-id>` (implies `--loki`)                      |
| Last distinct failures, grouped       | `haven errors --agent`                                                  |
| Recent root spans                     | `haven obs traces --json`                                               |
| One trace's span tree                 | `haven obs traces <trace-id> --json`                                    |
| Slow or failing traces                | `haven obs traces --min-duration 500ms --errors`                        |
| Filter traces                         | `haven obs traces --service api --name checkout --since 1h`             |
| Request rate, latency, queues, memory | `haven obs metrics --json`                                              |
| Functions burning CPU and heap        | `haven obs profiles --json`                                             |
| Each database server vs its limit     | `haven status --json stores`                                            |
| The one-shot lanes of the last up     | `haven status --json jobs` (install, codegen, migrations, seed, images) |
| Another worktree's stack              | add `--stack <slug>` to any of these                                    |

`haven logs` flags: `-f/--follow` (`-t` is retired and exits 64), `--since <dur>`, `--level warn|error`, `--loki`, `--grep <text>`,
`--trace <id>`, `--stack <slug>`, `--raw` (the child's own bytes), `--json` (one object per line,
lane stamped). `haven obs traces` also takes `--since` (default 10m).

- Services are lanes: `ui`, `api`, `go`, `sims`, `langy`, or a simulator name (`haven logs mail`).
  The api lane hosts the worker, so `haven logs api` and `haven logs worker` each show half of it.
  Under the default one-process mode the lane is `app` (`dev-runtime`).
- `--loki` and `--trace` need the observability stack (on by default with `haven up`); services match
  as substrings of the OTel service name.
- `--trace` finds only lines whose structured metadata carries `trace_id`; when none do it is
  empty, so fall back to `--since` around the trace's start time.
- `haven logs ui` shows each UI rebuild's `built in <ms>` and `ui bundle swapped in`.
- Never poll a slow boot in a loop. Read `haven status` once, later.

## Raw queries

When the flags cannot ask, `haven obs query traceql|logql|promql '<query>'` sends a raw query
(`--since` default 1h, `--limit` default 100, `--stack <slug>`, `--json`). Every selector gets this
worktree's filter forced in, so results never mix stacks; the scoped query is echoed in `query`.
`--json` returns `{query, grafana, data}`.

```bash
haven obs query traceql '{ status = error && duration > 1s }'
haven obs query logql 'sum by (service_name) (count_over_time({service_name=~".+"} |= "timeout" [5m]))'
haven obs query promql 'rate(http_server_request_duration_count[5m])' --since 30m
```

Never search the repo with `rg -uu` for a log string: use `git grep`. Stack will not come up or the
log is frozen: `troubleshooting.md` in the `haven` skill.
