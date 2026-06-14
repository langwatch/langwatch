# Per-PR Boxd preview VMs — feasibility investigation

**Date:** 2026-04-21
**Classification:** Proposal (feature)
**Status:** Investigated — not ready to implement without two preconditions below
**No GitHub issue yet.** File one before `/plan` runs.

## Starting state / context

The ask: add a GitHub Actions workflow that (a) provisions a Boxd VM forked from a golden image on every PR open/sync, runs LangWatch on it, exposes it at a predictable URL, and (b) keeps the golden fresh on every main merge. Destroy on PR close. Users review PRs by clicking a link instead of pulling the branch.

Boxd CLI lives at `/usr/local/bin/boxd`. The SSH surface `ssh boxd.sh '<cmd>'` mirrors most CLI subcommands. A golden VM already exists (`langwatch-main-golden-image`). A laptop wrapper `~/boxd-fork.sh` handles the LangWatch-specific fork boot today (manual flow).

## Consolidated design (end of 2026-04-21 iteration)

After several rounds of iteration, the shape is:

- **Staging** (not "golden") — one long-lived Boxd VM per Boxd account, owned by the repo bot (or per-dev in the fallback model). Staging is **not** a shared sandbox — no human SSH, no proxy-exposed URL for humans to hit. Only the bot and the refresh/fork paths touch it.
- **Main-merge refresh** = destroy and recreate staging from scratch (not `git pull` on a live VM), run a real domain-level health probe (login + a read + a write), only bless it as "ready" after the probe passes. Seeds run as part of refresh, designed idempotent (`create-if-null`).
- **Staging stays dataless at rest** — the server doesn't dogfood itself into its own Clickhouse (verified via grep), so an untouched staging accumulates no real rows between refreshes.
- **Per-PR fork** = `boxd fork langwatch-staging --name pr<N>`, then `boxd exec pr<N> -e BASE_HOST=https://pr<N>.boxd.sh -e NEXTAUTH_URL=https://pr<N>.boxd.sh -- 'cd workspace/langwatch && git checkout <sha> && docker compose -f compose.yml -f compose.dev.yml up -d'`, then `boxd proxy set-port --port=5560`. No file edits required — `compose.dev.yml:175-176` already parameterizes `BASE_HOST`/`NEXTAUTH_URL` from shell env with a localhost fallback, and the comment at `compose.dev.yml:170-174` explicitly anticipates this use case. `NEXTAUTH_PROVIDER: "email"` at `compose.dev.yml:181` avoids per-fork OAuth callback registration.
- **Quota** — soft cap = 4 `pr<N>` VMs; hard safety bound = 10 (the Boxd account ceiling). FIFO eviction of oldest `pr<N>` triggers when the soft cap is reached, well before the hard limit, so permanent VMs are never at risk. Separate scheduled reaper reconciles against GitHub PR state for orphans. (See issue #3433.)
- **Auth primary** — bot GitHub identity owns a Boxd account, ed25519 key paired once, private key in `secrets.BOXD_SSH_KEY`. Bot email: `user-test-agent@langwatch.ai` (org-controlled mailbox, confirmed available).
- **Auth fallback** — `workflow_dispatch` with per-dev `BOXD_TOKEN_<NAME>` JWT secrets; dispatcher owns their fork; main-merge iterates a `.github/boxd-accounts.yml` manifest to refresh every registered dev's staging (because cross-account sharing is not a Boxd primitive).
- **PostHog/analytics** — suppress on staging/forks via env override, otherwise previews pollute real telemetry.

## Remaining open questions (blockers for `/plan`)

1. Does Boxd accept the bot GitHub identity at sign-up? Email `user-test-agent@langwatch.ai` is available and viable; the only remaining verification is "walk through Boxd's browser-based SSH-key pairing flow as the bot user and confirm the key links cleanly." Falls out of the bootstrap in step A below — not a separate upfront question.
2. Real p50/p95 fork-to-domain-healthy time on the 100GB staging VM. Must be CI-acceptable or the UX premise dies.
3. ~~Full list of `*.boxd.sh` hostname references.~~ **Audited: non-issue.** Every hostname reference in `langwatch/src/` goes through `NEXTAUTH_URL` or `BASE_HOST`; compose.dev.yml already parameterizes both from the shell env (lines 170-176) with an explicit comment anticipating Boxd-proxied URLs. `NEXTAUTH_PROVIDER: "email"` (line 181) sidesteps per-fork OAuth callback registration. Fork boot = two `-e` flags on `boxd exec` — no file edits.

All other risks surfaced below have an agreed mitigation in the consolidated design. The findings below are preserved for historical context.

## Key findings

### 1. The naive shape is feasible but blocked by two preconditions that don't exist yet

**Precondition A — Quota within the 10-VM cap, managed via FIFO eviction.** No quota bump is being pursued. The workflow must live within the 10 VMs/account limit. Given ~5 permanent VMs already allocated (`langwatch-main-golden-image`, `orchard-rs`, `ai-gateway-3327`, `issue3201`, `orchard`), that leaves roughly 5 slots for previews. The design must:

- List all `pr<N>` VMs before provisioning a new one.
- If adding would exceed a configured soft cap (e.g. 4), destroy the oldest `pr<N>` VM (FIFO by creation timestamp, or equivalently by PR number if those correlate) to make room.
- Always destroy on PR close. The FIFO eviction is the safety net for missed close events, not the primary cleanup path.
- Hard stop (refuse to fork, comment on PR) if destroying the oldest still wouldn't fit — otherwise the workflow will start destroying the non-preview VMs the team depends on.

This trades off a small amount of convenience (oldest preview quietly disappears) for sidestepping the cap problem entirely. It does not solve any of the other findings below.

**Precondition B — Non-interactive auth via a GitHub bot identity (preferred) with a dev-dispatch fallback.**

**Primary path: repo bot account.** Create / use a dedicated GitHub bot user (e.g. `@langwatch-ci-bot`) with its own Boxd account. Generate an ed25519 keypair just for this bot, pair it once via Boxd's browser link flow (logged in as the bot), and store the private key as `secrets.BOXD_SSH_KEY` at the repo level. The workflow uses `ssh boxd.sh` with this key for all VM operations. The bot account owns the golden image and all `pr<N>` forks live in the bot's namespace. Rotation = "log in as the bot, re-pair" — a normal shared-secret lifecycle.

**Fallback path: dev-dispatched, dev-owned VMs.** If bot-account pairing turns out not to work (because Boxd accounts are strictly personal-GitHub-linked and won't accept a headless bot user), the fallback is:

- The workflow is dispatched via `workflow_dispatch` (or a labeled PR action), not on every push.
- Each participating dev has their own `BOXD_SSH_KEY_<NAME>` secret — or better, a `BOXD_TOKEN_<NAME>` JWT, since JWTs are individually revocable and don't grant the full SSH account surface.
- The workflow reads `github.actor`, selects that dev's credential, and forks into **their** Boxd account.
- That dev "owns" the preview VM for that PR.

Two problems with the fallback path, both need answers before relying on it:

1. **Golden images cannot be shared across Boxd accounts.** Verified via `docs.boxd.sh/llms-full.txt` — forking is within-account only, authentication is strictly per-account, and `/using-boxd/teams` returns 404. Workable mitigation: **fan-out main refresh across a registered-account manifest.** A file like `.github/boxd-accounts.yml` lists each participating dev's `{ github_actor, credential_secret_name, golden_vm_name }`. The `push: main` workflow iterates the manifest and, for each entry, SSHes with that dev's credential and refreshes *their* golden. PR dispatch uses the dispatcher's credential to fork *their* golden into *their* account. It's an annoying manifest to keep in sync, but it works. Costs: O(N-devs) main-merge runtime; per-dev drift (finding §2 applies independently in each account — each golden accumulates its own history); a one-time bootstrap per new dev to create the initial golden in their account; manifest maintenance when devs join/leave. Still preferable to "one centralized golden we can't reach." Other paths to keep on the shelf: (a) ship the golden as a Docker-image artifact from CI so first-time bootstrap is "pull & boot" rather than scripted clone+compose; (b) push Boxd for team accounts or cross-account sharing; (c) skip the warm-golden model and boot fresh per fork (simplest, but you lose the fast-review-click UX the whole thing was justified by).

2. **Private SSH keys as repo secrets is a security step down.** Any workflow on the repo with `secrets` access can read them. Prefer `BOXD_TOKEN_<NAME>` JWTs (scoped, revocable, short-TTL) over SSH private keys. Even then, treat the fallback as a short-term workaround, not the permanent shape.

**Strong recommendation:** do not design the workflow to hard-depend on the fallback. Target the bot-account path as v1; only use the dev-dispatch fallback if Boxd explicitly refuses to support bot-owned accounts. Confirm with Boxd support before committing.

### 2. "Refresh the golden on main merge" is deceptively hard

`ssh boxd.sh exec langwatch-main-golden-image -- 'git pull && docker compose up -d --build'` does **not** produce a clean golden. It mutates a long-lived VM:

- Prisma migrations run against whatever Postgres state the previous fork/user poked in. New forks inherit test data and accumulated artifacts.
- Docker layer cache, logs, Clickhouse/OpenSearch on-disk merge state, Redis dumps all grow unboundedly.
- A failed migration leaves the golden broken. Every subsequent PR fork inherits the broken state, and the `ssh` call's exit code can be green while the inner migration failed.
- Main merges can arrive faster than `compose up --build` completes. Concurrency serialization means the golden is chronically behind HEAD; parallel forks race against a half-applied update.

A real golden pipeline either (a) rebuilds the VM from scratch from a declarative spec on every merge (slow, deterministic), or (b) snapshots post-health-check and forks the snapshot. Neither is one `ssh exec` away.

**Update (iteration):** Boxd does not expose snapshot primitives — verified via full doc + CLI surface check. Available primitives are `new`, `fork`, `destroy`, `exec`; `--image` on `new` takes an OCI container image for the root filesystem, not a VM-state snapshot. Suspend/resume is "coming soon" per docs. So (b) is not available; the design has adopted (a): **destroy-and-recreate staging on main merge** with a real domain-level health probe before forks are allowed to target it. Seeds idempotent.

### 3. The in-VM NEXTAUTH_URL quirk is the tip of a config-drift iceberg

The golden's `langwatch/.env` pins `NEXTAUTH_URL` to the golden's hostname. Any fork fails Better Auth sign-in until overridden. `~/boxd-fork.sh` handles this for manual forks. CI needs the equivalent, and the same treatment will likely be needed for OAuth callback URLs, webhook destinations, CORS allowlists, email-link generation, and anything else with a hardcoded `*.boxd.sh` URL. These surface one at a time as "preview broken for feature X" bugs.

### 4. State contamination across PRs (resolved via no-direct-access policy)

**Originally flagged as structural.** Resolved during iteration: forks are COW overlays, so fork writes stay in the fork's overlay and never propagate back to staging. Cross-PR contamination only happens if staging itself accumulates state between refreshes — which only happens if humans poke it directly.

**Mitigation adopted:** staging is not exposed to humans. No shared proxy URL for devs to click, only bot/exec access. Combined with the verified fact that langwatch does not self-instrument into its own Clickhouse (checked via grep — no `new LangWatch()` in `langwatch/src/server/`), and with destroy-and-recreate refresh semantics in finding §2, staging stays dataless between refreshes. Cross-PR contamination is no longer a design concern.

One residual: the app emits product analytics to PostHog (external SaaS). Idle staging sends events that pollute real telemetry unless PostHog is disabled via env on staging and forks. Add that to the fork/staging env override step.

### 5. No API means no idempotency, retries, or observability

Boxd publishes no REST API, no webhooks, no GitHub Action, no Terraform provider. Orchestration is SSH-piped shell. You cannot reliably answer "does VM pr123 exist?", "what's its health?", "cancel the in-flight fork", without parsing CLI output. When a `ssh boxd.sh fork` call hangs or ambiguously fails, the workflow has no good recovery path — you'll leak VMs into the 10-cap silently unless you build a cron reaper that reconciles against GitHub PR state.

### 6. Fork-to-healthy time is unmeasured

`boxd fork` on a 100GB VM is fast *to allocate* (COW) but convergence to a domain-level healthy state (login works, trace ingest works) is unmeasured. "Curl returns 200" will declare success while Clickhouse is still replaying, producing a broken reviewer link. A real readiness probe is needed — and `boxd exec` + health curl + retry loop is more shell-script surface.

## Challenge findings

Ran `/challenge` on the preferred SSH-based shape. The devil's-advocate flipped the recommendation.

**Verdict: Consider alternatives first.** Three independent dealbreakers (10-VM cap, no API, broken golden-refresh semantics) plus a bus-factor bootstrap. The plan proposes to build bespoke infrastructure on top of a tool not designed for CI preview use. LangWatch **already ships a Helm chart** — the preview-env pattern on Kubernetes is mature, API-driven, observable, and reuses existing operational muscle memory.

Full output is in the investigation transcript; the three points that most changed the recommendation:

1. "You are proposing to build a production workflow on top of a single unreturned support email." Do not start until the cap is written.
2. "You would be trading a bespoke, undocumented, quota-capped, SSH-scripted, manually-bootstrapped system for the exact system you already ship to customers." (re: Helm)
3. "`git pull && docker compose up -d --build` on a live VM does not produce a golden. It produces the same dirty VM, one day older, with one more commit applied on top of all accumulated state."

## Strategies considered

| # | Strategy | Verdict | Why |
|---|----------|---------|-----|
| A | GH Actions → `BOXD_TOKEN` + external CLI. One VM per PR, fork-from-golden, destroy on close. Refresh golden on main via `exec`. | Viable but fragile | Hits all six findings above. Quota + golden-refresh + config drift are the real blockers. Token rotation is manual. |
| B | GH Actions → SSH to `boxd.sh` with dedicated CI keypair. Same flow as A. | Viable but fragile | Same failure modes as A; swaps token-rotation pain for SSH-key pairing pain. Matches user's original intuition. |
| C | Hybrid: CI posts to a webhook on a persistent `pr-controller` Boxd VM; controller runs `boxd fork/exec/destroy` using in-VM automatic auth. | Nicer auth story | Avoids CI-side credential mgmt (in-VM auth is automatic via the `10.1.0.1:9002` metadata server). But it's new infra (controller service + retry semantics), and the controller itself counts against the 10-VM cap. |
| D | Shared preview VM with per-PR docker-compose projects and per-port proxies (1 Boxd VM total). | **Best within Boxd** | Sidesteps the 10-VM cap entirely. Cost: noisy-neighbor risk; bad migration breaks all previews. Acceptable for a small team if migration-changing PRs are flagged. |
| E | Helm-chart preview envs on Kubernetes (one namespace per PR). | **Recommended if a cluster exists** | LangWatch already ships this chart. Real API, quotas per namespace, observable, API-driven teardown. Trades Boxd's dev-loop ergonomics for production-grade preview infra. |
| F | Stateless Next.js preview (Vercel/Render/Fly/Cloud Run) pointing at shared staging backing services. | **Recommended if UI-only review suffices** | Seconds-to-deploy, no VM caps, near-zero idle cost. Loses per-PR data isolation — PRs with schema changes must fall back to A/D/E. |
| G | Do nothing automatic. Keep `/boxd golden` manual; CI refreshes only the golden VM on main merge (partial goal). | Minimal | Solves half the ask. Zero new failure modes. A sensible stepping stone before going further. |

## Findings for the implementer

Do **not** skip straight to writing workflow YAML. In order:

1. **Confirm with Boxd that a bot GitHub identity can own its own Boxd account and pair an SSH key.** This is the single load-bearing precondition. If yes → build the bot-account design (primary path). If no → the dev-dispatch fallback has the cross-account golden-sharing problem above and needs its own design work before it's viable.
2. **Time a `boxd fork` of `langwatch-main-golden-image` to domain-level health**, end-to-end, manually, from a cold cache. Instrument it. Numbers, not vibes. This is the load-bearing number for "is this CI-fast?"
3. **Decide whether per-PR data isolation is actually required.** If UI review is the real goal, strategy F is 10× cheaper. If isolated data matters (testing migrations, seeding fixtures), strategies A/C/D/E are candidates.
4. **If proceeding with Boxd (A/B/C/D): design golden refresh as a rebuild or snapshot, not a `git pull` on a live VM.** See finding §2.
5. **Budget time for the NEXTAUTH_URL class of bugs.** Audit `langwatch/.env` and the golden's `.env` for any hardcoded `*.boxd.sh` host. Plan for an env-override phase in the fork boot script. See finding §3.
6. **Build the reaper before the happy path, and wire FIFO eviction into the fork path.** Before every `boxd fork pr<N>`, list current `pr<N>` VMs and destroy the oldest if the soft cap (e.g. 4) would be exceeded. Separately: a scheduled workflow that lists all `pr<N>` VMs, checks each PR's state via `gh pr view --json state`, and destroys `CLOSED` / `MERGED` orphans. Both guards are needed — FIFO handles missed close events in the moment, the scheduled reaper handles the long tail.
7. **Required secrets (all set at the repo/org level, owned by the bot identity — never tied to a personal account):** For A: `BOXD_TOKEN` (JWT issued via `ssh boxd.sh token create` from the bot's linked SSH session). For B: `BOXD_SSH_KEY` (ed25519 private key generated for the bot, public key paired once to the org Boxd account) plus `boxd.sh` entries in `known_hosts`. Already-existing repo secrets like `DOCKERHUB_TOKEN` / `SLACK_RELEASE_NOTIFICATION_WEBHOOK_URL` are the pattern to follow for storage and access control.
8. **Concurrency group:** `boxd-pr-${{ github.event.pull_request.number }}` with `cancel-in-progress: true`. Matches existing SDK-workflow convention in the repo.
9. **Workflows to model after:**
   - `pr-auto-approve.yml` — `pull_request_target` usage, bot-comment post/update patterns, concurrency scoping
   - `publish-docker-app.yml` — release-on-merge build pattern, if you go the "build image then deploy" route

Things ruled out from the "naive" shape:

- Refreshing the golden with `exec -- 'git pull && docker compose up -d --build'` on a live VM — produces dirty state (§2).
- Relying on `curl /` as a readiness probe — too shallow to catch Clickhouse/OpenSearch startup failures (§6).
- Assuming `boxd` CLI output is a stable machine interface — use `--json` flags where available and be ready for format changes.

## Caveats

- **Cross-account VM sharing is not supported** (per `docs.boxd.sh/llms-full.txt`). The mitigation in the dev-dispatch path is the registered-account manifest — main refresh fans out over every listed account. That turns a quota problem into a maintenance-overhead problem (manifest drift, per-dev drift in each golden, O(N) main runtime). Verify with Boxd support whether anything else has landed.
- Boxd quota wording is "10 concurrent machines." Docs do not say whether **stopped** VMs count. If stopped VMs don't count, a "stop on PR idle, resume on activity" model could stretch the cap further and reduce FIFO eviction pressure. Verify before relying on it.
- The max `token create --expires` value is undocumented. If it's short (hours/days), token rotation becomes part of the runbook. If long (months/years), it's effectively a static secret.
- `aris-katkova/boxd-cli` is a third-party wrapper, not official. Do not depend on it in CI; use the official binary or raw `ssh boxd.sh`.
- VMs created before this workflow (including `orchard`, `orchard-rs`, `ai-gateway-3327`) are not going anywhere. The workflow must not assume it owns the account.
- Storage cap per account is not in the docs I could find. 5 concurrent 100 GB COW forks under write load could hit an undocumented ceiling. Add to the "verify before committing" list.

## Next steps

1. File a GitHub issue for this proposal with a link to this doc.
2. Block the issue on:
   - Written Boxd quota confirmation (owner: someone with Boxd account admin)
   - Measured fork-to-healthy p50/p95 on the real golden (owner: implementer)
3. Reconvene on strategy choice (E vs D vs F vs A) once both numbers are in.
4. Only then run `/plan` on the chosen strategy.

Do not `/plan` this until the preconditions are answered. The shape of the workflow depends entirely on which strategy survives them.
