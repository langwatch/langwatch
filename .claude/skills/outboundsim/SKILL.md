---
name: outboundsim
description: "Catch and inspect the stack's outbound Slack, webhook and SQS sends with outboundsim, haven's stand-in for those destinations, and inject receiver faults. Use when someone says 'did the Slack alert fire', 'webhook delivery', 'check the signature', 'retry a failing receiver', 'SQS message', 'outboundsim', 'haven outbound', or needs to assert on an outbound message in a test."
user-invocable: true
---

# outboundsim

Fakes Slack (incoming webhooks and the Web API: `chat.postMessage`, `conversations.list`,
`auth.test`), any webhook receiver, and SQS `SendMessage` (JSON protocol). Every call becomes
one record in memory, bounded; tokens are checked for presence only: a dev shim, never expose
it. Code: `services/outboundsim`, console `apps/outboundsim-web`.

## Run it

- Opt-in: `haven up +outbound` (sticky). Hosted in the `sims` lane.
- Console and base URL: `https://outbound.<slug>.langwatch.localhost`.
- The overlay points the four internal Slack channel settings at it and sets
  `WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS=1`, each only when `.env` leaves it unset. A webhook
  destination you create in the app points at `<base>/hooks/<name>`; `haven outbound urls`
  prints every URL to paste.

## Drive it from a terminal

```
haven outbound status | urls
haven outbound records [--channel slack-webhook|slack-api|webhook|sqs] [--target] [--json]
haven outbound deliveries                # webhook retries grouped by event id
haven outbound wait --channel webhook [--target] [--count 1] [--timeout 30s]
haven outbound fault add --channel webhook --status 503 [--retry-after 5] [--times 2]
haven outbound fault add --channel webhook --latency 20000 | --drop   # ms
haven outbound fault list | clear [id]
haven outbound receiver set <name> --secret <s>   # verify LangWatch delivery signatures
haven outbound clear
```

`wait` is how a test or agent asserts a send happened; it exits non-zero on timeout.

## HTTP

```
GET    /_sim/api/records?channel=&target=&eventId=&since=
DELETE /_sim/api/records
GET    /_sim/api/deliveries
GET|POST|DELETE /_sim/api/faults[/{id}]
PUT|DELETE /_sim/api/receivers/{name}     {"secret": "..."}
GET    /_sim/api/status | /_sim/api/setup
```

A wrong or missing signature is recorded with its verdict, never refused. Spec:
`specs/setup/outboundsim.feature`.
