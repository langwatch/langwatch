# Handoff: apidiff-r45-residue

Status: partial
Manifest: .claude/manifests/apidiff-r45-residue.md
Updated: 2026-09-28 01:10

## 1. Identity

apidiff r45 residue, lane-opus, attempt 1.

## 2. Objective

Fix three r45 behaviour drifts from main (langy placeholder title, CLI ingestion key device label,
GET /api/projects count), and tidy the apidiff tool (per-field noise rulings, instant-eval coverage,
hollow collection checks).

## 3. Owned paths

The files the six manifest items need (manifest "Rules"). Not tools/visualdiff (another lane).

## 4. Shared paths - do not edit

Everything else; the native ClickHouse server config is machine state, not repo.

## 5. Work completed

1. Langy placeholder title: a new conversation's first-message title now goes through main's
   sentence-case normaliser (main: titleFromFirstUserMessage -> normalizeLangyConversationTitle,
   platform/app/src/server/app-layer/langy/langyConversationTitle.ts). The branch sliced raw text to 80.
   "apidiff question" -> "Apidiff question" on conversationStart and userMessage.
2. CLI personal ingestion key: the personal mint now labels the key with deviceLabelForSession(client_info)
   (main auth-cli.ts:2802), so a CLI without device metadata gets "unknown-device" and the name
   "Ingestion key (copilot_app, unknown-device)". The project path already matched main.
3. GET /api/projects: diagnosed, not changed (blocked on a design decision, see section 11).
   The branch lists the "Governance (internal)" project (kind internal_governance). Main excludes it
   in the listing's own repository read (project.prisma.repository.ts:246 on origin/main).
4. apidiff rulings: added the per-field rulings for the langy approve `/endpoint` and `/sessionKey`
   and the langy requests `/requests/*/conversationUrl`. The rest of each body is still compared
   (the test keeps /conversation/title unruled). The /api/query `database` rulings already existed but
   the pattern `run\d+_` missed run ids like `run45g`; it is now `apidiff_[a-z0-9_]+_(main|branch)`.
5. Instant evals: root cause found. POST /api/instant-evals answers 500 on both sides because LWQL
   provisioning fails on the run's EXTERNAL ClickHouse: "Not enough privileges ... DROP NAMED
   COLLECTION ON lwql_postgres" (statement 18/712). The branch then fails auth as apidiff_lwql_branch.
   The judge stub is already configured. The managed compose stack now grants
   named_collection_control to the default user (users.d config). The external path still needs
   a machine change (section 9).
6. Hollow collection lists: confirmed. verifyCollections ran after every DELETE (deletes rank last),
   so each created entity (webhook endpoint, workflow and about 20 others) had already been deleted
   when its list was re-read. It now runs just before the first DELETE, or at the end when there
   is none.

## 6. Files changed

modules/langy (@langwatch/langy-process)
- modified process/src/rules/langy-conversation-title.rules.ts (placeholderTitleOf)
- modified process/src/services/langy-turn-preparation.service.ts
- modified process/src/services/__tests__/langy-turn-preparation.service.unit.test.ts
- modified specs/langy.feature (+1 @unit scenario)

enterprise/modules/governance (@langwatch/enterprise-governance-process)
- modified process/src/services/governance-cli-credentials.service.ts
- modified process/src/transport/__tests__/governance-cli.rest.unit.test.ts
- modified specs/governance.feature (+1 @unit scenario)

tools/apidiff
- modified probe-rulings.go, probe-rulings_test.go
- modified probe.go, probe-post_test.go
- modified boot.go, collaborators_test.go

Not mine, though dirty in the same trees: governance/browser costSampleMode test, governance/browser elements/__tests__/.

## 7. Checks completed

- pnpm --filter @langwatch/langy-process test (turn-preparation + title rules) -> 33 passed
- pnpm --filter @langwatch/enterprise-governance-process test (governance-cli.rest + personal-ingestion-key) -> 31 passed
- pnpm --filter @langwatch/langy-process typecheck -> clean
- pnpm --filter @langwatch/enterprise-governance-process typecheck -> clean
- oxfmt + oxlint --type-aware on the 5 touched TS files -> clean
- check:feature-parity -> langy.feature 8/8 bound; both new scenarios bound. The run banner still fails on pre-existing debt elsewhere.
- tools/apidiff: gofmt -l clean; go vet ./... clean; go test ./... -> ok
- Sabotage: with the before-delete hook disabled, the new collection test fails ("created entity not visible")

## 8. Current failure

none

## 9. Exact next action

Item 3 needs Alex's ruling (section 11). Before the next apidiff run, grant the external ClickHouse
user named-collection control, or run with the managed stack. For a brew/native server, add a
users.d file such as `<clickhouse><users><default><named_collection_control>1</named_collection_control></default></users></clickhouse>`
and restart ClickHouse. This is a machine change, so it is Alex's call. Then check r46 for:
- no "lwql ... ACCESS_DENIED" lines;
- POST /api/instant-evals answering 2xx on both sides;
- the four /api/instant-evals/{id} operations no longer skipped.

## 10. Shared-file requests

none

## 11. Risks

- Item 3 decision (blocked). Main hides kind=internal_governance from GET /api/projects only.
  Branch ProjectApi.listByOrganization feeds 9 peers: analytics lwql scope, data-retention org scope,
  api-key catalogue and cli, coding-agent x2, model-provider, ops checkup, agent. So a repository-wide
  filter would change them. Main's data-retention org scope includes governance projects
  (dataRetentionPolicy.repository.ts:182 on origin/main). Options:
  (a) a new ProjectManagementApi operation that answers the listing without internal projects. This is a new
      *Api op and needs approval.
  (b) an input flag on ProjectApi.listByOrganization, which changes the contract.
  (c) a global repository filter: rejected, it regresses data retention and possibly others.
- Langy: main's titleFromFirstUserMessage also names the guided-onboarding kickoff conversation
  "Getting started" (guidedKickoffPartOf). The branch has no such server path; the constant sits only
  in onboarding browser-kit. Not ported: the detection would have to move into a contract. Flagged, not in scope.
- governance-cli-credentials.service.ts keeps its own findDeviceLabel, which duplicates
  api-key-contract's normalizeDeviceLabel. Left as is.
- The collection pass now runs mid-loop. Creates that land after the first DELETE (none today; DELETE ranks last)
  would not be verified.

## 12. Unfinished work

1. GET /api/projects governance exclusion, once Alex picks an option from section 11.
2. External ClickHouse named_collection_control grant (machine), then confirm instant-eval coverage in r46.

## 13. Completion status

Items 1, 2, 4 and 6 have landed and each is independently committable. Item 5 is fixed for the managed
stack; the external stack needs a machine grant. Item 3 is blocked on a design decision.
