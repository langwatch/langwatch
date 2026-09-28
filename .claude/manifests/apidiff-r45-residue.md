# apidiff r45 residue

Model: opus 5.5 high (`lane-opus`). Why: three small behaviour ports plus probe-fixture work needing judgment.

Report: .apidiff/report-20260928-r45.json (findings[]; in `fields` pairs the FIRST value is main, the SECOND the branch).
Stderr: .apidiff/run-20260928-r45.stderr.log. Probe packets: /tmp/apidiff-run45g/probe.

## Fix (product, behaviour from main)
1. Langy fallback conversation title: main "Apidiff question", branch "apidiff question"
   (GET /api/langy/control/requests, POST .../approve, POST /api/langy/control/connect/register).
   Port main's capitalisation exactly (find main's code with `git show origin/main:<path>`).
2. CLI ingestion key name: main "Ingestion key (copilot_app, unknown-device)", branch "Ingestion key (copilot_app)"
   (GET /api/api-keys after POST /api/auth/cli/governance/ingestion-key). Port main's naming incl. the device part.
3. GET /api/projects: main lists 5 projects, branch 6. Find which probe step creates an extra project on the
   branch only (or which main hides — archived? personal?) and port main's behaviour; if it's a fixture
   artefact, fix the fixture and say why.

## Tool (tools/apidiff)
4. Rule as noise (probe-rulings.go, per-field): langy approve `/endpoint` and `/sessionKey`, langy requests
   `/requests/0/conversationUrl` (port + random id), and `/api/query/reference` + `/api/query/schema`
   `database` (per-run ClickHouse database name) — rule only that field, keep the rest of the body compared.
5. Coverage: /api/instant-evals/{id}, /cancel, /results, /sample are skipped and GET /api/instant-evals
   unverified because POST /api/instant-evals created nothing on either side (needs the LWQL identity and a
   configured judge). Make the probe provision what it needs so both sides create one; zero skipped is the bar.
6. Stderr shows "created entity not visible in either list" for webhooks endpoints and workflows lists — check
   whether those list comparisons are hollow (both empty) and fix the fixture/settle if so.

## Rules
Shared checkout, other sessions active: touch only the files these items need. Never git stash, never commit,
never pnpm install, never read .env, never spawn subagents, no `as` casts, comments <= 5 lines, errors as
HandledErrors. Spec scenarios for 1-3 in the owning module's specs with bound tests. Scoped format+lint+
typecheck+tests per package; `go test ./... && go vet ./...` in tools/apidiff. Do not run a full apidiff run
(coordinator does). Handoff: .claude/handoffs/apidiff-r45-residue.md listing every file touched.
