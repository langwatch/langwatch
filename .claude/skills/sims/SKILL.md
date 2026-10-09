---
name: sims
description: "Map of LangWatch's local simulators and how they run: llmsim, mailsim, storagesim, analyticssim, idpsim, voicesim, outboundsim and telemetrysim, the haven sims lane, the single Go mono-binary (`service combined`), the ADR-160 consoles and load runs. Use when someone says 'which simulators are there', 'sims', 'run it locally at scale', 'load test the sims', 'haven up +llm', 'the sims lane', 'where is the sim console', 'add a simulator', or does not know which sim to use."
user-invocable: true
---

# Simulators

Start here: `haven sims --json` lists every simulator with whether it runs in this stack, its
console URL, the `haven up +<name>` it needs if off, its verbs (read from haven's own command
table) and its skill path. `--stack <slug>` reads another worktree's stack.

Eight Go simulators stand in for outside services so a stack runs offline, deterministically
and for free. Code is `services/<name>` and each console is a React app, `apps/<name>-web`,
built by Vite into the Go package's `web/dist` and embedded (ADR-160,
`dev/docs/adr/160-internal-consoles-are-go-served-react.md`).

| Sim            | Stands in for                                       | haven        | Skill                                      | Seed env               |
| -------------- | --------------------------------------------------- | ------------ | ------------------------------------------ | ---------------------- |
| `llmsim`       | OpenAI, Anthropic                                   | `+llm`       | `llmsim`                                   | none (built-in corpus) |
| `mailsim`      | SMTP                                                | default      | `mailsim`                                  | `MAILSIM_SEED`         |
| `storagesim`   | S3                                                  | default      | `storagesim`                               | `STORAGESIM_SEED`      |
| `analyticssim` | PostHog, Customer.io                                | `+analytics` | `analyticssim`                             | `ANALYTICSSIM_SEED`    |
| `idpsim`       | OIDC, SAML, SCIM IdP                                | default      | `idpsim`                                   | none (seeded tenants)  |
| `voicesim`     | ElevenLabs voice, OpenAI audio                      | `+voice`     | `voicesim`                                 | `VOICESIM_SEED`        |
| `telemetrysim` | OTLP senders (traces, logs, metrics, coding agents) | `+telemetry` | [`telemetrysim`](../telemetrysim/SKILL.md) | `--seed` per run       |
| `outboundsim`  | Slack, webhook receivers, SQS                       | `+outbound`  | `outboundsim`                              | `OUTBOUNDSIM_SEED`     |

Each has a console at `<name>.<slug>.langwatch.localhost` (names: `llm`, `mail`, `storage`,
`analytics`, `idp`, `voice`, `outbound`, `telemetry`) and logs via `haven logs <name>`. `haven up +llm +analytics`
selects (sticky); `-mail` deselects. haven sets every `*_SEED=1`. Two shared console packages,
`@langwatch/design-system-internal` and `@langwatch/sim-console`, draw all of them; no
Chakra, no product design system.

## Where they run: one Go mono-binary

- The Go services are one binary, `cmd/service`. `service combined` hosts the data plane
  (aigateway, nlpgo) and, in a dev build only (`-tags dev`, `cmd/service/combined_dev.go`),
  the eight simulators. Release images build untagged: no simulator is linked.
- In a dev checkout haven runs every selected sim in the `sims` lane: a second
  `service combined` process beside the `go` lane, so a sim under load cannot starve the
  gateway. `haven restart sims` bounces them all. `haven logs <name>` still reads each.
- A checkout whose mono-binary has no `combined` subcommand, or a monolith build, runs
  haven's bundled copy of each sim as one lane each (`haven simulator <name>`, hidden).
- Without haven: `make service svc=combined args="mailsim storagesim llmsim analyticssim voicesim idpsim telemetrysim outboundsim"`,
  or one sim: `make service svc=<name>`. `make service-watch svc=<name>` adds air reload.
  `make service` builds the console bundle first; a binary without it serves a one-line
  page naming the build command.
- A new simulator is one entry in the `simulators` list in `cmd/service/combined_dev.go`
  (its own comment says so), plus its `apps/<name>-web` console.

## Load runs

1. `haven up +llm +analytics`, then `haven status` for each loopback port.
2. Drive `127.0.0.1:<port>` directly; the routed hostnames add the proxy to your numbers.
3. Reset between runs: DELETE on each sim's list (see its skill); idpsim resets per tenant.
4. Every sim keeps bounded history (mail 10000 messages, analytics 5000 records, llm 500
   calls, voice 200 calls), so a long run cannot grow memory without limit.
5. Benchmarks: `go test -bench . -benchmem ./services/<name>` for mail, storage, analytics.

## Deeper

`dev/docs/LOCAL_STACK.md` (simulators and the sims lane), `tools/thuishaven/README.md`
(hostname scheme), and `services/<name>/README.md` where one exists (llmsim, mailsim,
storagesim, idpsim).

## CLI parity

Every console action has a verb (`--json` on reads, non-zero exit on failure, `--stack <slug>`):

| Sim       | Verbs                                                                                                                 |
| --------- | --------------------------------------------------------------------------------------------------------------------- |
| mail      | `haven mail address\|inbox\|list\|get <id>\|links <id>\|wait\|delete <id>\|clear`                                    |
| llm       | `haven llm info\|calls [--model <text>] [--failed]\|call <id>\|clear\|set --error --seed`                               |
| analytics | `haven analytics status\|records\|record <id>\|clear\|wait --event`                                                   |
| storage   | `haven storage buckets\|objects [bucket]\|object <bucket> <key> [--raw]\|presign\|delete\|clear [bucket]\|seed\|requests` |
| voice     | `haven voice status\|calls\|call <id>\|clear`                                                                         |
| telemetry | `haven telemetry send\|load\|fuzz\|status\|stop`                                                                      |
| outbound  | `haven outbound status\|records\|deliveries\|wait --channel\|fault add\|list\|clear\|receiver set\|urls\|clear`       |
| idp       | `haven idp tenants\|tenant show\|apps add\|populate\|churn\|scim ...\|signin\|reset` (full list: `haven sims --json`) |
