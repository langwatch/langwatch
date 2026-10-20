# Upgrade diagnostics via LangWatch Connect

Status: built on `feat/upgrade-diagnostics` (2026-10-20). Decisions are under "Decided"; what
changed while building it is under "Corrections from building it", and the sections above it are
kept in step with those corrections. The upgrade-alert email
(`packages/mail/src/templates/upgrade-alert-email.tsx`) is worded for it.

## Problem

A background upgrade step that fails on a self-hosted installation is almost
always our bug. The operator cannot fix it. Today the most they can do is retry
the step from Ops, Upgrades, and copy what the step page shows into an email to
support@langwatch.ai. We want a one-click "send to LangWatch" from the step page,
and an opt-in to send these automatically.

## What a failed background step blocks (checked in `packages/upgrade`)

- Serving: nothing. The serving gate refuses only when a **blocking** step failed
  (`packages/upgrade/src/gate/serving-upgrade-gate.ts:169-173`).
- Other steps: a background step that declares `after` on the failed one waits
  until it is done or not needed (`background/background-steps.service.ts:196`).
- The step's own work (a backfill, a replay) stays incomplete until it finishes.
- The Upgrades page shows "Needs attention" (`reader/installation-state.ts:37`).
- The next `upgrade` run sets failed background steps back to pending
  (`runner/upgrade-runner.ts:1084`), and the step page has a Retry button.

## What the install would send

One bundle per step, built on the install. A manual send shows it in a preview first and sends
that previewed bundle. An automatic send shows nothing first and keeps no copy on the install; the
step page shows the bundle as it stands now:

| Field                                                     | Source                                                                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| step id, kind, mode, release, status, attempt, updated at | ledger step row                                                                                                 |
| `lastError`                                               | step `last_error` (`packages/upgrade/src/ledger-tables.ts`)                                                     |
| step `report`                                             | step `report` JSONB (its targets and counts)                                                                    |
| target errors                                             | target rows' `last_error`                                                                                       |
| step log tail                                             | the step's own `log_tail` column: the last 200 lines of its latest attempt, redacted when written              |
| image release, chart version, install method              | ops config facts already in the usage report                                                                    |
| instance id                                               | `InstanceIdentityService` (licensing)                                                                           |

Nothing outside the ledger is read, with two named exceptions: the ops config facts (release,
chart version, install method) and the instance id above. The error, report and log lines are what
the step wrote, after redaction, so they can still name something such as a project id; the
preview is where an operator sees that.

Before this change there was no per-step worker log: worker lines went to stdout or OpenTelemetry
only. Decision 3 added the bounded per-step tail.

### Redaction

- Run every string through `redactSecrets` / `redactValue`
  (`packages/upgrade/src/runner/run-log.ts:42-46`) before the bundle is built.
  `last_error` is stored **unredacted** today (`upgrade-runner.ts:658` stores
  `error.message`), so this is not optional.
- Additionally replace every value of the process's declared secret handles
  (`packages/secrets/src/redact.ts`, the `redactOutput` approach in
  `stepping/prisma-tool.ts:56`).
- Customer data can appear in a validation error (a zod issue quoting a value).
  Cap each string (4 KB) and drop zod `received`/`input` fields; a manual send
  previews the exact bundle it sends. An automatic send is not kept on the install.

## Install end (licensing)

- New channel method beside `ConnectLicenseChannel.syncLicense`
  (`enterprise/modules/licensing/process/src/channels/`): `sendUpgradeDiagnostics`,
  posting to the licence host with the same headers (`Bearer <licence token>`,
  `x-langwatch-instance`, `http.connect-host.channel.ts:170`).
- Ops owns the step page and the ledger reader; it asks licensing through its
  `*Api` to send a bundle. Ops never holds the channel.
- Step page: a "Send to LangWatch" action next to Retry, for `ops:manage`,
  with a preview of the bundle. Shown only when Connect is available.
- Setting (Settings, Checkup): "Always send upgrade diagnostics to LangWatch", on by
  default for installs with Connect (decision 4), opt-out by the setting or an env var. When
  on, the hourly alert check sends a bundle for each newly failed step, keyed by step id and
  `updatedAt` so it is sent once.

## Hosted end (licensing's Connect host door)

- New route `POST /v1/upgrade-diagnostics` on the licence host door
  (`enterprise/modules/licensing/process/src/transport/connect-host.rest.ts`),
  authenticated by the existing `licence_token` credential. Not under
  `/api/internal/gateway/connect/*`: those are gateway-signed calls for gateway
  traffic (`enterprise/modules/connect/process/src/transport/connect-hosted.rest.ts`),
  and a diagnostics bundle has nothing to do with the gateway.
- Lands as a `SelfHostedInstanceDiagnostic` row beside the self-hosted instance record, with the
  bytes in object storage, and one Slack webhook message per instance, step and release, so the
  team sees "instance X: step Y failed on 3.23.0" with a link to the instance in Cloud admin.
- Size-capped (64 KB) and rate-limited per instance.

## Installs without Connect

`LANGWATCH_CONNECT_DISABLED`, no licence, or an air-gapped network
(`licensing.app.ts:967-985` builds no channel then):

- The step page offers "Copy diagnostics" and "Download diagnostics" (the same
  redacted bundle as JSON), and says to send it to support@langwatch.ai.
- This fallback is worth building first: it needs no hosted route and covers every
  install.

## Copy that changes when this lands

`PlainBody` in `upgrade-alert-email.tsx` today says: "copy the details shown on
the step page and send them to support@langwatch.ai". When the send lands:

- With Connect: "send the details to the LangWatch team from the step page".
- With "always send" on: "We have already received the details and are looking
  into it." (needs the audience prop to carry whether a bundle was sent).
- Without Connect: "download the diagnostics from the step page and send them to
  support@langwatch.ai".

The email cannot say "reply to this email": a self-hosted install sends from its
own address, so a reply never reaches us.

## Decided (2026-10-19)

Alex decided 3, 4 and 5 (5: "you decide, S3, max 30 days"). 1, 2 and 6 were proposals and are
built as proposed; the pull request asks for their confirmation.

1. Route home: the licence host door, `POST /v1/upgrade-diagnostics`, licence token.
2. Unlicensed installs get copy/download only; no public intake.
3. Build a bounded per-step log tail: the last ~200 lines per attempt, redacted at write,
   kept on the step's ledger row and shown on the step page.
4. "Always send" is on by default for installs with Connect, with an opt-out (env var and
   Ops setting), listed in the Data and telemetry docs and shown on Checkup. Prerequisite:
   redaction and dropping zod `received`/`input` values ship first.
5. Bundles land in object storage under `upgrade-diagnostics/` (ADR-172, no `stored_objects`
   row), eu-central-1 (where all Cloud data lives), expired by a lifecycle rule at 30 days; a
   `SelfHostedInstanceDiagnostic` row points at the object and feeds Cloud admin and Slack.
6. `last_error` is redacted at write time in the ledger.

## Slack (Alex, 2026-10-19)

The first report of an instance, step and release posts one message to a Slack webhook:
metadata only (instance, release, step id and description, attempt, whether it was sent
automatically) plus a link to the instance in Cloud admin. No error text or log lines in Slack
itself. A presigned link in the message was rejected: it lives at most 7 days, and signed with the
pod's role credentials it dies with that session. The link opens the instance drawer of the
self-hosted instances view
(`modules/ops/browser/src/features/admin/ui/sections/self-hosted-instances-view.tsx`, served by
`enterprise-ops` `self-hosted-instance.trpc.ts`), which lists every unexpired report for that
install; Download mints a five-minute signed link on click, behind the platform-operator
permission. A report stays listed until its 30 days are up. A webhook cannot thread, so later
reports of the same step and release post nothing and are listed in Cloud admin only.

## Build order

1. Redact on write, per-step log tail, Copy / Download diagnostics (no Cloud dependency).
2. Hosted route, S3 storage with the 30-day rule, Slack signal.
3. Send to LangWatch, the auto-send default and opt-out, docs, Checkup, email copy.

## Corrections from building it (2026-10-20)

- A background step has no run row (`run_id` is `background:<owner>`), so the log tail lives in
  its own step column, `log_tail`, written at the end of each attempt; `report` is the checkpoint
  and is replaced on every save. Steps receive a `log` in their run arguments.
- Secret values cannot be read back from `@langwatch/secrets`; the serving gate passes the store
  URLs it already resolved into the background runner's redactor.
- Storage follows ADR-172, not stored-object: expiring bytes get no `stored_objects` row. Licensing
  writes `upgrade-diagnostics/<instanceId>/<reportId>.json` through the object-storage member on
  the platform tenant, and the 30-day expiry is a lifecycle row in `charts/langwatch/values.yaml`
  (Cloud's bucket rule is set outside this repo). Download is the member's `signDownload`, 5 minutes.
- The REST rate limit counts per organisation; the per-instance limit is licensing's own limiter,
  as license sync does.
- Slack: the self-hosted signal path was never composed. A webhook cannot thread, so one message
  is posted per instance, step and release; later reports of that step are listed in Cloud admin
  only. Threading needs a bot token and a stored `ts`; left for a human decision.
- Cloud admin's instance drawer is opened from page state; it now also opens from `?instance=`,
  which is the link Slack carries.
- The bundle schema is ops' (`modules/ops/contract/src/features/migrations/ops-upgrade-diagnostics.ts`):
  no core contract depends on an enterprise one. Licensing's contract imports it for the submission.
- The automatic-send opt-out is a third switch beside the usage-report ones (stored on the
  instance identity row), plus `DISABLE_UPGRADE_DIAGNOSTICS_AUTO_SEND`. The step page shows the
  bundle as it stands, not a stored copy of what an automatic send sent.
- The alert email picks its closing line from what happened: details already sent, sendable from
  the step page, or downloadable to email to support.
