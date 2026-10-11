---
name: outboundsim
description: "Catch and inspect the stack's outbound Slack, webhook and SQS sends with outboundsim, haven's stand-in for those destinations, and inject receiver faults. Use when someone says 'haven outbound', 'did the Slack alert fire', 'webhook delivery', 'check the signature', 'retry a failing receiver', 'SQS message', 'outboundsim', 'haven sim outbound', 'haven up +outbound', or needs to assert on an outbound message in a test."
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
- The overlay points the four internal Slack channel settings at it, sets
  `SLACK_API_BASE=<base>/api` and `SLACK_WEBHOOK_BASE=<base>` (so a bot token check,
  `chat.postMessage` and a `https://hooks.slack.com/...` test fire land here, not at Slack) and
  `WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS=1`, each only when `.env` leaves it unset. A webhook
  destination you create in the app points at `<base>/hooks/<name>`; `haven sim outbound urls`
  prints every URL to paste.

## Drive it from a terminal

```
haven sim outbound status | urls
haven sim outbound list [--channel slack-webhook|slack-api|webhook|sqs] [--target] [--json]
haven sim outbound deliveries                # webhook retries grouped by event id
haven sim outbound wait --channel webhook [--target] [--count 1] [--timeout 30s]
haven sim outbound fault add --channel webhook --status 503 [--retry-after 5] [--times 2]
haven sim outbound fault add --channel webhook --latency 20000 | --drop   # ms
haven sim outbound fault list | clear [id]
haven sim outbound receiver set <name> --secret <s>   # verify LangWatch delivery signatures
haven sim outbound clear
```

`wait` is how a test or agent asserts a send happened; it exits 66 on timeout.

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

## Governance pull vendors

outboundsim also answers the reads governance pull sources make (`databricks.go`, `feed.go`):
Databricks Genie (`/api/2.0/genie/spaces`, conversations, messages), Databricks SCIM users
(`/api/2.0/preview/scim/v2/Users`), the service-principal sign-in (`POST /oidc/v1/token`) and a
generic usage feed for custom HTTP pulls (`GET /feeds/<name>?cursor=<n>`; events at `$.events`,
cursor at `$.next_cursor`). A word in the bearer token (or client id) picks the workspace:
`empty`, `revoked` (401), `noscope` (403), `ratelimited` (429), `down` (503), `malformed`
(200 HTML) or `cycle` (repeating page token); anything else is a seeded three-space workspace.
Faults use channels `databricks` and `feed`, target = the path. `PUT /_sim/api/databricks/users`
replaces the SCIM directory. The product cannot reach these yet: the Databricks workspace URL
guard and the hard-wired OpenAI, Anthropic and Microsoft hosts await a ruling (handoff fl-vsim).
