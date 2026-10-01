---
name: sims
description: "Map of LangWatch's local simulators and how they run: llmsim, mailsim, storagesim, analyticssim (plus idpsim and voicesim), the haven sims lane, the single Go mono-binary and load runs. Use when someone says 'which simulators are there', 'sims', 'run it locally at scale', 'load test the sims', 'haven up +llm', 'the sims lane', or does not know which sim to use."
user-invocable: true
---

# Simulators

| Sim            | Stands in for                  | haven        | Skill          | Seed env               |
| -------------- | ------------------------------ | ------------ | -------------- | ---------------------- |
| `llmsim`       | OpenAI, Anthropic              | `+llm`       | `llmsim`       | none (built-in corpus) |
| `mailsim`      | SMTP                           | default      | `mailsim`      | `MAILSIM_SEED`         |
| `storagesim`   | S3                             | default      | `storagesim`   | `STORAGESIM_SEED`      |
| `analyticssim` | PostHog, Customer.io           | `+analytics` | `analyticssim` | `ANALYTICSSIM_SEED`    |
| `idpsim`       | OIDC/SAML IdP                  | default      |                |                        |
| `voicesim`     | ElevenLabs voice, OpenAI audio | `+voice`     | `voicesim`     | `VOICESIM_SEED`        |

Each has a console at `<name>.<slug>.langwatch.localhost` and logs via `haven logs <name>`.
`haven up +llm +analytics` selects (sticky); `-mail` deselects. haven sets every `*_SEED=1`.

## Where they run

- In a dev checkout (`cmd/service/combined_dev.go`, `-tags dev`) every selected sim runs in
  the `sims` lane: a second `service combined` process. The `go` lane keeps only the gateway
  and nlp, so a sim under load cannot starve them. `haven restart sims` bounces them.
- Monolith or older checkouts run haven's bundled copies as one lane each.
- Without haven: `make service svc=combined args="mailsim storagesim llmsim analyticssim voicesim"`.

## Load runs

1. `haven up +llm +analytics`, then `haven status` for each loopback port.
2. Drive `127.0.0.1:<port>` directly; the routed hostnames add the proxy to your numbers.
3. Reset between runs: DELETE on each sim's list (see its skill).
4. Every sim keeps bounded history (mail 10000 messages, analytics 5000 records, llm 500
   calls, voice 200 calls), so a long run cannot grow memory without limit.
