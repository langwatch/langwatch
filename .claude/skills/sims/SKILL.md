---
name: sims
description: "Map of LangWatch's local simulators and how they run: llmsim, mailsim, storagesim, analyticssim, idpsim, voicesim, outboundsim, paymentsim, telemetrysim and lambdasim, the haven sim lane, the single Go mono-binary (`service combined`), the ADR-160 consoles and load runs. Use when someone says 'haven sims', 'which simulators are there', 'sims', 'run it locally at scale', 'load test the sims', 'haven up +llm', 'the sims lane', 'where is the sim console', 'add a simulator', or does not know which sim to use."
user-invocable: true
---

# Simulators

Start here: `haven sim --json` lists every simulator with whether it runs in this stack, its
console URL, the `haven up +<name>` it needs if off, its verbs (read from haven's own command
table) and its skill path. `--stack <slug>` reads another worktree's stack.

Eleven Go simulators stand in for outside services so a stack runs offline, deterministically
and for free. Code is `services/sims/<name>` and each console is one surface of the React app
`apps/sims` (`apps/sims/src/<surface>`, e.g. `llm`, `mail`), built by Vite and embedded in the Go
package (ADR-160,
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
| `outboundsim`  | Slack, webhook receivers, SQS, governance pull APIs | `+outbound`  | `outboundsim`                              | `OUTBOUNDSIM_SEED`     |
| `paymentsim`   | Stripe (API, signed webhooks, meters)               | default      | `paymentsim`                               | `PAYMENTSIM_CATALOG`   |
| `lambdasim`    | AWS Lambda + CloudWatch Logs (NLP Lambda fleet)     | `+lambda`    | [`lambdasim`](../lambdasim/SKILL.md)       | none                   |
| `githubsim`    | GitHub App, API, pull requests, signed webhooks     | `+github`    | [`githubsim`](../githubsim/SKILL.md)       | `GITHUBSIM_SEED`       |

Passkeys, security keys, U2F tokens and TOTP codes are emulated in the browser, not by a Go
sim: [`mfasim`](../mfasim/SKILL.md) (`haven browser mfa`, on a `haven browser` lane).

Each has a console at `<name>.<slug>.langwatch.localhost` (names: `llm`, `mail`, `storage`,
`analytics`, `idp`, `voice`, `outbound`, `telemetry`, `lambda`) and logs via `haven logs <name>`. `haven up +llm +analytics`
selects (sticky); `-mail` deselects. haven sets every `*_SEED=1`. Two shared console packages,
`@langwatch/design-system-internal` and `@langwatch/sim-console`, draw all of them; no
Chakra, no product design system.

## Where they run: one Go mono-binary

- The Go services are one binary, `cmd/service`. `service combined` hosts the data plane
  (aigateway, nlpgo) and, in a dev build only (`-tags dev`, `cmd/service/combined_dev.go`),
  the simulators. Release images build untagged: no simulator is linked.
- By default haven runs every selected sim inside the `go` lane, in the same process as the
  gateway and nlpgo (`LANGWATCH_DEV_ONE_PROCESS` defaults on). Sim load is therefore gateway
  load, and `haven restart go` bounces both. `LANGWATCH_DEV_ONE_PROCESS=0` splits Go and sims
  into two processes (a `sims` lane beside `go`); then `haven restart sims` bounces only the sims.
  `haven logs <name>` reads each sim either way.
- A checkout whose mono-binary has no `combined` subcommand, or a monolith build, runs
  haven's bundled copy of each sim as one lane each (`haven simulator <name>`, hidden).
- Without haven: `make service svc=combined args="mailsim storagesim llmsim analyticssim voicesim idpsim telemetrysim outboundsim paymentsim lambdasim githubsim"`,
  or one sim: `make service svc=<name>`. `make service-watch svc=<name>` adds air reload.
  `make service` builds the console bundle first; a binary without it serves a one-line
  page naming the build command.
- A new simulator is one entry in the `simulators` list in `cmd/service/combined_dev.go`
  (its own comment says so), plus its surface under `apps/sims/src/<name>`.

## Load runs

1. `haven up +llm +analytics`, then `haven status` for each loopback port.
2. Drive `127.0.0.1:<port>` directly; the routed hostnames add the proxy to your numbers.
3. Reset between runs: DELETE on each sim's list (see its skill); idpsim resets per tenant.
4. Every sim keeps bounded history (mail 10000 messages, analytics 5000 records, llm 500
   calls, voice 200 calls), so a long run cannot grow memory without limit.
5. Benchmarks: `go test -bench . -benchmem ./services/sims/<name>` for mail, storage, analytics.

## Deeper

`dev/docs/LOCAL_STACK.md` (simulators and the Go lane), `tools/thuishaven/README.md`
(hostname scheme), and `services/sims/<name>/README.md` where one exists (llmsim, mailsim,
storagesim, idpsim).

## CLI parity

Every console action has a verb (`--json` on reads, non-zero exit on failure, `--stack <slug>`):

| Sim       | Verbs                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------- |
| mail      | `haven sim mail address\|status\|list\|get <id>\|links <id>\|wait\|delete <id>\|clear`                                    |
| llm       | `haven sim llm status\|list [--model <text>] [--failed]\|get <id>\|clear\|fault <status>\|config --seed`                  |
| analytics | `haven sim analytics status\|list\|record <id>\|clear\|wait --event`                                                      |
| storage   | `haven sim storage buckets\|objects [bucket]\|object <bucket> <key> [--raw]\|presign\|delete\|clear [bucket]\|seed\|list` |
| voice     | `haven sim voice status\|list\|get <id>\|clear`                                                                           |
| telemetry | `haven sim telemetry send\|load\|fuzz\|status\|stop`                                                                      |
| outbound  | `haven sim outbound status\|list\|deliveries\|wait --channel\|fault add\|list\|clear\|receiver set\|urls\|clear`          |
| payment   | `haven sim payment status\|list\|usage\|advance --seconds\|fault --customer\|deliver --ids\|hold\|release\|clear`         |
| lambda    | `haven sim lambda status\|list\|get <id>\|clear\|fault <kind>`                                                            |
| github    | `haven sim github status\|list\|pulls\|calls\|deliveries\|install\|pr\|app\|deliver\|fault\|clear\|reset`                 |
| idp       | `haven sim idp list\|get\|apps add\|populate\|churn\|scim ...\|signin\|clear` (full list: `haven sim --json`)             |
