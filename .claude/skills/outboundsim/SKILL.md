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
Faults use channels `databricks`, `feed` and `vendor`, target = the path. `PUT /_sim/api/databricks/users`
replaces the SCIM directory.

`vendors.go` adds small OpenAI (`/openai/v1/organization/users|projects`), Anthropic
(`/anthropic/v1/organizations/users|me`) and Microsoft (`/microsoft-login/<tenant>/oauth2/v2.0/token`,
`/microsoft-graph/v1.0/users|subscribedSkus`) routes, same tenant words in the key or bearer.
The same file serves the paged reports and feeds: `GET /openai/v1/organization/costs` (daily
buckets, one per page, `next_page`; a key holding `nokeys` refuses `group_by[]=api_key_id` so the
puller falls back), `/anthropic/v1/organizations/usage_report/messages` and `/cost_report` (same
paging), `/anthropic/v1/organizations/audit_log?cursor=<n>` (claude-compliance, 7 events, 3 a page),
`/microsoft-graph/v1.0/auditLogs/directoryAudits` (absolute `@odata.nextLink`) and Dataverse at
`/dataverse/api/data/v9.2/bots|conversationtranscripts` (7 conversations over 2 bots, 3 a page,
reads the puller's `$filter` continuation and bot ids, Microsoft token as bearer). Extra words for
the paged reports: `flaky` (503 on every page after the first), `cycle` (same next page forever).
Fault target = the path, e.g. `--channel vendor --target /openai/v1/organization/costs --status 429`.

### Reaching it from the product

`haven up +outbound` sets one base per vendor (unless .env names it): `DATABRICKS_WORKSPACE_BASE`
(the outbound origin), `OPENAI_ADMIN_API_BASE`, `ANTHROPIC_ADMIN_API_BASE`, `MICROSOFT_LOGIN_BASE`,
`MICROSOFT_GRAPH_API_BASE` (origin + `/openai`, `/anthropic`, `/microsoft-login`,
`/microsoft-graph`). Unset or blank means the real vendor. A request to exactly that origin is the
one local address the pull fence allows. In the UI, type the outbound origin
(`haven status` shows it) as the Databricks workspace URL.

Tester recipes:
- GOV-56: Governance > Sources > Add Databricks Genie, workspace URL = outbound origin, token
  `dapi-good`; Agents > Sync lists 3 spaces. Repeat with `dapi-revoked|noscope|ratelimited|down|
  malformed|cycle`: refusals unauthorized, forbidden, rate_limited, unavailable, malformed_response,
  pagination_stalled. `dapi-empty`: no agents. One-off: `haven sim outbound fault add --channel
  databricks --target /api/2.0/genie/spaces --status 404 --times 1` -> not_found.
- GOV-06: the Genie source pulls 6 messages (2 per space); `haven sim outbound list --channel
  databricks` shows the reads. Custom HTTP pull: URL `<outbound>/feeds/usage`, bearer `feed-good`,
  eventsJsonPath `$.events`, cursorJsonPath `$.next_cursor`, cursorQueryParam `cursor`: 5 events,
  next run 0. Non-local custom URLs stay as before.
- GOV-50: `curl -X PUT <outbound>/_sim/api/databricks/users -d '[{"id":"1001","userName":
  "<member email>","active":true},{"id":"1002","userName":"<same email>","active":true}]'`, pull;
  People shows suggestions to confirm and a duplicate to refuse. OpenAI/Anthropic member lists
  (`sk-admin-good`) give three `@sim.vendor.test` people.
- GOV-44: Copilot Studio Dataverse source with any tenant id and client secret (a tenant word in
  the secret picks the failure: `revoked`, `noscope`). Sign-in, seats (`subscribedSkus`), the
  directory (`users`) and `directoryAudits` work. Environment URL = `<outbound>/dataverse`: expect
  2 agents and 7 conversations over 3 pages, then 0 on the next run (the cursor continues after
  the last row). Caveat: the product only accepts an https `*.dynamics.com` environment URL
  (`isEnvironmentOrigin`) and refuses next links off it; until the product admits the Dataverse
  origin the transcript read cannot reach the sim, and the source reports the URL as invalid.
- GOV-44 reports: OpenAI admin cost source (`sk-admin-good`): 3 daily buckets, 6 cost rows, one page
  each; `sk-admin-nokeys` drops the key dimension, `sk-admin-flaky` fails after page one and resumes.
  Anthropic usage and cost sources (`sk-ant-admin-good`) page the same. Claude compliance and the
  Microsoft directory audits as custom pulls: 7 events, then 0.
