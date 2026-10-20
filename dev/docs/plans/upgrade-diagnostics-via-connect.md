# Upgrade diagnostics via LangWatch Connect (design, not built)

Status: decided 2026-10-19, not built. Decisions below under "Decided". The upgrade-alert email
(`packages/mail/src/templates/upgrade-alert-email.tsx`) is already worded for it.

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

One bundle per step, built on the install. A manual send shows it in a preview first; an
automatic send does not, and the step page shows exactly what was sent:

| Field                                                     | Source                                                                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| step id, kind, mode, release, status, attempt, updated at | ledger step row                                                                                                 |
| `lastError`                                               | step `last_error` (`packages/upgrade/src/ledger-tables.ts`)                                                     |
| step `report`                                             | step `report` JSONB (its targets and counts)                                                                    |
| target errors                                             | target rows' `last_error`                                                                                       |
| run log tail                                              | the latest run's `report.logTail` (50 info/warn lines, already redacted by `RunLog`, `runner/run-log.ts:10,42`) |
| image release, chart version, install method              | ops config facts already in the usage report                                                                    |
| instance id                                               | `InstanceIdentityService` (licensing)                                                                           |

Not sent: organisation, project or user names, row contents, environment
variables, anything outside the ledger, with two named exceptions: the ops config
facts (release, chart version, install method) and the instance id above.

There is **no per-step worker log** stored today: worker lines go to stdout or
OpenTelemetry only. A "recent worker log lines for this step" field needs either a
bounded per-step tail kept by the background runner (the same `RunLog` shape) or
is left out. See open decision 3.

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
  previews the exact bundle, and every sent bundle stays viewable on the step page.

## Install end (licensing)

- New channel method beside `ConnectLicenseChannel.syncLicense`
  (`enterprise/modules/licensing/process/src/channels/`): `sendUpgradeDiagnostics`,
  posting to the licence host with the same headers (`Bearer <licence token>`,
  `x-langwatch-instance`, `http.connect-host.channel.ts:170`).
- Ops owns the step page and the ledger reader; it asks licensing through its
  `*Api` to send a bundle. Ops never holds the channel.
- Step page: a "Send to LangWatch" action next to Retry, for `ops:manage`,
  with a preview of the bundle. Shown only when Connect is available.
- Setting (Ops, Upgrades): "Always send upgrade diagnostics to LangWatch", on by
  default for installs with Connect (decision 4), opt-out by the setting or an env var. When on, the hourly alert check sends a bundle for each newly failed
  step, keyed by step id and `updatedAt` so it is sent once.

## Hosted end (licensing's Connect host door)

- New route `POST /v1/upgrade-diagnostics` on the licence host door
  (`enterprise/modules/licensing/process/src/transport/connect-host.rest.ts`),
  authenticated by the existing `licence_token` credential. Not under
  `/api/internal/gateway/connect/*`: those are gateway-signed calls for gateway
  traffic (`enterprise/modules/connect/process/src/transport/connect-hosted.rest.ts`),
  and a diagnostics bundle has nothing to do with the gateway.
- Lands as a row on the self-hosted instance record (beside
  `SelfHostedInstanceService.recordReport`, `self-hosted-instance.service.ts:69`)
  and a Slack signal through the existing `self-hosted-crm.service.ts` path, so
  the team sees "instance X: step Y failed on 3.23.0" with a link to the bundle
  in Cloud admin.
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

Alex decided 3, 4 and 5 (5: "you decide, S3, max 30 days"); 1, 2 and 6 are proposals
not yet confirmed.

1. Route home: the licence host door, `POST /v1/upgrade-diagnostics`, licence token.
2. Unlicensed installs get copy/download only; no public intake.
3. Build a bounded per-step log tail: the last ~200 lines per attempt, redacted at write,
   kept on the step's ledger row and shown on the step page.
4. "Always send" is on by default for installs with Connect, with an opt-out (env var and
   Ops setting), listed in the Data and telemetry docs and shown on Checkup. Prerequisite:
   redaction and dropping zod `received`/`input` values ship first.
5. Bundles land in S3 through stored-object under `upgrade-diagnostics/`, eu-central-1
   (where all Cloud data lives), expired by an S3 lifecycle rule at 30 days; a row on the
   self-hosted instance record points at the object and feeds Cloud admin and Slack.
6. `last_error` is redacted at write time in the ledger.

## Slack (Alex, 2026-10-19)

Each received bundle posts one Slack message through the self-hosted signal path: metadata only
(instance, organisation on the licence, release, step id and description, attempt, first and
latest failure time, whether it was sent automatically) plus a link to the bundle, valid 7 days.
No error text or log lines in Slack itself. Caveat: a presigned S3 URL lives at most 7 days and
only when signed with long-lived IAM keys; signed with the pod's role credentials it dies when
that session does (hours). Decided: the link opens the report in Cloud admin (a "Diagnostics" tab on the existing
self-hosted instances view, `modules/ops/browser/src/features/admin/ui/sections/self-hosted-instances-view.tsx`,
served by `enterprise-ops` `self-hosted-instance.trpc.ts`). The page lists every report for
that install with its metadata; Download mints a short-lived presigned URL (minutes) on click,
behind the platform-operator permission. The Slack link stops opening after 7 days; the
report stays listed in Cloud admin until S3 expires it at 30 days. One message per
step and release; later attempts thread under it.

## Build order

1. Redact on write, per-step log tail, Copy / Download diagnostics (no Cloud dependency).
2. Hosted route, S3 storage with the 30-day rule, Slack signal.
3. Send to LangWatch, the auto-send default and opt-out, docs, Checkup, email copy.
