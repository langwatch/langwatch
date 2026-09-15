# The dev log format

Every LangWatch process writes the **same structured JSON on stdout, in every
environment**. Production ships it to Loki unchanged. A terminal never sees it
raw: `haven` and `pnpm dev` each render it for a person, from the one written
spec below, so a stack of eight services reads as one stream instead of eight
consoles.

Before this, `api` and `workers` printed pino-pretty, `gateway`/`nlp`/`langy`
printed `zap-prettyconsole`, `idp` printed JSON, and Vite printed prose — four
clocks, three level columns and two colour schemes under haven's own lane
prefix. The rule now is: **children emit, the viewer renders**.

## What a child writes

One JSON object per line, on stdout:

```json
{"time":"2026-09-07T11:10:46.108Z","level":"info","msg":"listening","service":"langwatch-api","port":6560}
```

| Field     | Required | Shape |
| --------- | -------- | ----- |
| `time`    | yes      | RFC 3339, UTC, millisecond precision |
| `level`   | yes      | lowercase word: `trace` `debug` `info` `warn` `error` `fatal` |
| `msg`     | yes      | the message, no timestamp, level or service in the text |
| `service` | yes      | the process identity (`langwatch-api`, `langwatch-service-nlpgo`, …) |
| `stack`   | on error | the full multi-line trace, as one string with `\n` in it |
| anything else | — | the line's own fields |

Vite writes the same shape too, through a `customLogger` (`apps/ui/vite/dev-logging.ts`)
that replaces its own two-digit clock and `[vite]` tag: a multi-line message  - 
the startup banner, a stack - becomes one record, its lines rejoined with `\n`
in `msg` (or, for an error, split into `msg` plus `stack`), rather than one
record per line. Node's own crash output and the lane wrappers still fall
through as passthrough (see below).

Where it is configured:

- Node — `packages/observability/src/logger-config.ts`. `format` defaults to
  `json` in every environment; `LOG_FORMAT=pretty` is the explicit opt-out for
  someone running one lane bare with no renderer in front of it.
- Go — `pkg/clog`. `LOG_FORMAT` defaults to `json`, and the JSON encoder writes
  `time` (RFC 3339 ms) rather than zap's default `ts` (epoch float).

## What a viewer renders

```
HH:MM:SS.mmm  lane       level  msg  key=value  key=value
```

- Time is **local** wall time to the millisecond, dimmed. A record's own `time`
  wins; a line without one takes the instant it was captured.
- Lane is a fixed 9 columns (fits `storybook`), in that lane's palette colour
  from `tools/thuishaven/app/plan.go`.
- Level is a fixed 5 columns (fits `error`): `debug` and `trace` dim, `info`
  plain, `warn` yellow, `error` and `fatal` red.
- Fields are sorted by key, two spaces apart, keys dimmed. A value is printed
  bare unless it is empty or contains a space, a quote or an `=`, in which case
  it is quoted. Objects and arrays print as compact JSON.
- `pid`, `hostname`, `service`, `version`, `env` and `service.version` are
  dropped: they are constant for the process and the lane column already says
  which one it is.
- A `stack` prints on the following lines, indented four spaces, dimmed.
- A **non-JSON line** keeps the time and lane columns, leaves the level column
  blank, and is otherwise passed through byte for byte — so a Vite banner and a
  Node stack frame still line up with the structured lines around them.
- Colour is off when the destination is not a TTY, when `NO_COLOR` is set, and
  under `haven --agent`.

Two implementations, one spec, one fixture:

- Go — `tools/thuishaven/domain/logfmt`, used by `haven logs`, `haven logs -t`,
  the attached `up` viewer and the supervisor's live echo.
- Node — `dev/scripts/log-render.mjs`, which `pnpm dev` pipes every lane
  through (`dev/scripts/lane.sh`).

Both are tested against `dev/scripts/fixtures/dev-log-lines.jsonl` and must
produce `dev/scripts/fixtures/dev-log-lines.expected.txt` byte for byte. Change
the format in one and the other's test fails.

## Escape hatches

- `haven logs --raw` prints the captured payload untouched, escapes and all.
- `haven logs --json` prints one JSON object per line with `lane` stamped on
  it, including for lines that were not JSON to begin with.
- `LOG_FORMAT=pretty` still selects each library's own pretty console, for a
  lane run bare in its own terminal.

## Reading it in Grafana

`level` is lowercase on the wire. A LogQL filter written against the old
uppercase Node value (`| level=~"WARN|ERROR"`) must be widened or lowercased.
