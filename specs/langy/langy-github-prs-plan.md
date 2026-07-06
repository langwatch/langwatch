# Plan: Langy opens GitHub PRs as the requesting user

- **Issue:** langwatch/langwatch#4747
- **Branch:** `langy/github-prs-plan` (this doc) → implementation PRs listed below
- **Base:** `langy/per-session-manager` (PR #4272)
- **Spec:** `specs/langy/langy-github-prs.feature` (added alongside this plan)

## Goal

A user tells Langy "fix the prompt drift in repo X and open a PR" and a real PR appears
on GitHub **authored by that user** — created by their per-session OpenCode worker, using
a short-lived GitHub App user-to-server token that rides the existing credential handoff.
Users who haven't connected GitHub get a friendly "Connect GitHub in settings" reply, never
an error. Tokens never touch disk.

## Target flow

```
 Settings page                      Chat time                          Worker pod
 ─────────────                      ─────────                          ──────────
 user clicks                        /api/langy/chat                    spawnWorker()
 "Connect GitHub"                        │                                  │
      │                                  ▼                                  ▼
      ▼                       LangyCredentialService          env: GH_TOKEN, GITHUB_LOGIN
 GitHub App OAuth             .getOrProvision()                          │
 (user-to-server)                        │                               ▼
      │                                  ▼                       skills/github.md:
      ▼                       langyGithubToken.ts:              shallow clone → branch →
 /api/github-langy/callback   decrypt refresh token,           commit → gh pr create
      │                       mint 8h access token                       │
      ▼                                  │                               ▼
 UserGitHubCredential row     credentials.githubToken          PR on GitHub, authored
 (encrypted refresh token)    credentials.githubLogin          by the requesting user
```

## What already exists (reuse, don't reinvent)

| Thing | Where | Reuse for |
|---|---|---|
| Credential handoff seam | `LangyCredentialService.getOrProvision()` (`langwatch/src/server/services/langy/LangyCredentialService.ts:72`) → `/api/langy/chat` body (`langwatch/src/server/routes/langy.ts:310-326`) → `spawnWorker()` env (`services/langy-agent/server.js:321-350`) | `githubToken` + `githubLogin` ride the same path; **no second secrets channel** |
| Provisioning module pattern | `langyApiKey.ts`, `langyVirtualKey.ts` (idempotent provision + `findFirst` read + P2002 race handling) | New `langyGithubToken.ts` mirrors the shape |
| Encrypted secret storage | `ProjectSecret` model + `encrypt()`/`decrypt()` from `langwatch/src/utils/encryption.ts` (aes-256-gcm, `CREDENTIALS_SECRET`) | Same encryption for the new `UserGitHubCredential` model (new model because this is **per-user**, not per-project) |
| GitHub OAuth *login* provider | `langwatch/src/server/better-auth/index.ts:63-72` (`GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`) | Callback-route conventions only. **Do not reuse the login app** — identity login ≠ App user-to-server auth |
| Worker skills | `services/langy-agent/skills/*.md`, seeded by `entrypoint.sh:19-21`, symlinked per-worker in `setupWorkerHome()` | New `skills/github.md` |
| CLI install point | `Dockerfile.langy_agent` apt block (~line 23) | Add `gh` |
| Egress policy | `charts/langy-agent/templates/networkpolicy.yaml` + `values.networkPolicy.*` | `github.com`/`api.github.com`/`codeload.github.com` egress |
| Idle reaper | `server.js:393-400` (30s sweep, 10 min TTL, kills worker + home dir) | Clone dir lives inside worker home → cleaned for free |
| Rate limiting | `checkLangyMessageRateLimit` (`rate-limit-langy.ts`, 30 msg/min, Redis sliding window) | PR creation already behind it; add per-user daily PR cap in skill/manager |
| Audit log | `auditLog(...)` pattern (`routes/langy.ts:501-508`) | `langy.github.connect` / `.disconnect` / `.pr_created` actions |
| Scenario tests | `langwatch/src/tests/langy/langy.scenario.test.ts` (judge + Layer-2 REST verification) | New github scenario |

## Locked decisions

| What | Choice | Why |
|---|---|---|
| Auth mechanism | GitHub App with **user-to-server OAuth** | PRs attribute to the user; installation bounds reachable repos; org admin controls scope. OAuth apps can't bound repos; PATs are unmanageable/unattributable. |
| Token storage | New `UserGitHubCredential` Prisma model, encrypted refresh token only | Per-user (not per-project) lifetime; `ProjectSecret` is the wrong scope. Access tokens (8h) are minted on demand, never stored. |
| Token transport | Extend `LangyCredentials` with optional `githubToken` + `githubLogin` | Existing route → manager → worker handoff; zero new channels. |
| Worker git auth | `GH_TOKEN` env + `gh` CLI; git pushes via `credential.helper '!gh auth git-credential'` | gh reads the token from env — nothing written to `.gitconfig`/`.git-credentials` on disk. |
| Commit author | `git config user.name <githubLogin>` + `<id>+<login>@users.noreply.github.com` | Commits AND the PR attribute to the user without exposing their email. |
| Unconnected users | `githubToken` absent → skill tells Langy to reply with settings deep link | Graceful degradation, not an error. |
| Token expiry | Keep GitHub App token expiration ON (8h access / 6mo refresh, rotating) | Short blast radius; refresh handled server-side in `langyGithubToken.ts`. |
| New REST surface | One OAuth callback route (`/api/github-langy/callback`) + connect/disconnect via existing tRPC settings routers | Callback is unavoidable for OAuth; everything else stays in existing routers. |

## UX: auth + PR live inside the conversation (claude.design-style)

The settings page exists, but the **primary** auth and PR experience happens inside the
Langy sidebar — no context switch to a settings tab, no raw URLs in chat.

```
 ┌─ Langy chat ───────────────────────────────────────────────┐
 │ you  > fix the prompt drift in acme/service-x, open a PR   │
 │                                                            │
 │ langy ─ Acme/service-x isn't connected to your GitHub yet. │
 │ ┌─────────────────────────────────────────────┐            │
 │ │  Connect GitHub                             │            │
 │ │  We'll open the PR as @aryansharma28        │            │
 │ │  [ Connect GitHub ]                         │ ← card     │
 │ └─────────────────────────────────────────────┘            │
 │                                                            │
 │ langy ─ Connected as @aryansharma28. Working on it.        │
 │ ─ cloning acme/service-x …                                 │
 │ ─ branch langy/fix-prompt-drift …                          │
 │ ─ committing 2 files …                                     │
 │ ─ opening PR …                                             │
 │                                                            │
 │ ┌─────────────────────────────────────────────┐            │
 │ │ ◍  acme/service-x #482                      │            │
 │ │ Fix prompt drift in checkout-eval            │            │
 │ │ +47 −12  ·  by @aryansharma28               │            │
 │ │ [ View on GitHub ]                          │ ← PR card  │
 │ └─────────────────────────────────────────────┘            │
 │                                                            │
 │ sidebar footer:  ◉ Acting as @aryansharma28  ↗            │
 └────────────────────────────────────────────────────────────┘
```

Five UX primitives drive this:

1. **In-chat connect card** — a structured message type `connect_github` rendered by `LangySidebar`, not raw markdown. Worker emits it when `GH_TOKEN` is absent.
2. **Popup OAuth flow** — `/api/github-langy/connect?mode=popup` opens a small window; callback shim posts `window.opener.postMessage({type:"github-connected", login})` and closes itself. Chat state preserved. Same endpoint serves `mode=redirect` for the settings-page flow.
3. **Live progress events** — worker emits structured status events (`cloning|branching|committing|opening_pr`) that the manager streams as system-style chat lines, not free-text.
4. **PR card** — structured `github_pr` message (title, repo, +/- stats, author, URL) returned as a tool result, not a URL pasted in the reply.
5. **"Acting as" chip** — sidebar footer shows the connected GitHub identity. Hover → Disconnect. Eliminates "did this PR really land as me?" anxiety.

**Tradeoff acknowledged:** the OAuth callback is a new public REST endpoint
(`/api/github-langy/callback`). The "no new Langy REST endpoints" rule was about MCP
plumbing; OAuth callbacks can't be tunneled through tRPC, so this is a conscious
exception.

## Phased delivery (6 PRs, each independently shippable)

### PR 1 — Spec + data model
*Branch `langy/github-prs-1-model`, base `langy/per-session-manager`*

- [ ] `specs/langy/langy-github-prs.feature` — `@unimplemented` scenarios (shipped with this plan; flip tags as built)
- [ ] Prisma: `UserGitHubCredential` model
  ```prisma
  model UserGitHubCredential {
    id                    String   @id @default(nanoid())
    userId                String
    user                  User     @relation(fields: [userId], references: [id])
    organizationId        String
    organization          Organization @relation(fields: [organizationId], references: [id])
    githubLogin           String
    githubUserId          String
    encryptedRefreshToken String
    scopes                String?
    createdAt             DateTime @default(now())
    updatedAt             DateTime @default(now()) @updatedAt

    @@unique([userId, organizationId])
    @@index([organizationId])
  }
  ```
- [ ] Migration dir `YYYYMMDDHHmmss_user_github_credential` (mirror `20260508153928_langy_memory` conventions)
- [ ] Register model with the multitenancy guard (`langwatch/src/utils/dbMultiTenancyProtection.ts`): org-scoped via `organizationId`, plus always-filter-by-`userId` predicate. **Gotcha:** guard rejects compound-key `findUnique` — use `findFirst({ where: { userId, organizationId } })` like `langyApiKey.ts:62` does.
- [ ] Env plumbing: `GITHUB_LANGY_APP_ID`, `GITHUB_LANGY_CLIENT_ID`, `GITHUB_LANGY_CLIENT_SECRET` in `env.mjs` + `.env.example` (all optional — feature silently off when unset)

### PR 2 — Connect/disconnect (settings + popup) + OAuth callback
*Branch `langy/github-prs-2-connect`*

- [ ] `GET /api/github-langy/connect?mode=popup|redirect&return=...` — redirects to `https://github.com/login/oauth/authorize` with the App's client_id + CSRF `state` (signed, short-lived, carries `mode`)
- [ ] `GET /api/github-langy/callback` — exchanges code → `{access_token, refresh_token, expires_in}`; fetches `/user` for `githubLogin`/`githubUserId`; upserts `UserGitHubCredential` with `encrypt(refresh_token)`. **`mode=popup`** → tiny HTML shim that calls `window.opener.postMessage({type:"github-connected", login})` and closes; **`mode=redirect`** → 302 back to `return` URL (defaults to settings deep link).
- [ ] Settings UI in `langwatch/src/pages/settings/` — "Connect GitHub" card: connected state shows `githubLogin` + Disconnect button; disconnect deletes the row AND calls GitHub's token-revocation API (`DELETE /applications/{client_id}/grant`)
- [ ] `auditLog` on connect (`langy.github.connect`) and disconnect (`langy.github.disconnect`)
- [ ] Deep link constant (e.g. `/settings/integrations#github`) exported for the skill to reference

### PR 3 — Token minting in the credential handoff
*Branch `langy/github-prs-3-credentials`*

- [ ] `langwatch/src/server/services/langy/langyGithubToken.ts`:
  - `getGithubTokenForUser({ prisma, userId, organizationId })` → `{ token, githubLogin } | null`
  - Decrypts refresh token → `POST https://github.com/login/oauth/access_token` (`grant_type=refresh_token`) → returns 8h access token
  - **Rotation:** GitHub rotates refresh tokens on use — persist the new one in the same transaction. Guard the refresh with a short Redis lock (`langy:gh:refresh:${userId}`) so two concurrent chats don't race the single-use rotation.
  - Cache the minted access token in Redis (`langy:gh:at:${userId}:${orgId}`, TTL ~7h) to avoid refreshing every message
  - On refresh failure (revoked App, expired refresh token): delete the credential row, return null — degrades to "not connected"
- [ ] `LangyCredentialService.getOrProvision()` — after VK provisioning, call the above (needs `actorUserId`, already a param); add to `LangyCredentials`:
  ```typescript
  /** Short-lived GitHub user-to-server token. Absent when user hasn't connected GitHub. */
  githubToken?: string;
  /** GitHub login of the requesting user, for commit attribution. */
  githubLogin?: string;
  ```
- [ ] Best-effort: GitHub minting failure must NOT break chat — catch, `captureException`, omit fields (same philosophy as `project.ts:227-265` provisioning hooks)
- [ ] No change needed in `routes/langy.ts` — `credentials` is already posted whole (`langy.ts:310-326`) ✨

### PR 4 — Worker side: gh CLI, env injection, github skill
*Branch `langy/github-prs-4-worker`*

- [ ] `Dockerfile.langy_agent` — install `gh` (GitHub's apt repo, pinned version; ubuntu 24.04 base at line 11)
- [ ] `services/langy-agent/server.js`:
  - Accept optional `credentials.githubToken`/`githubLogin` in the `/chat` body schema (lines 56-76)
  - `spawnWorker()` env (next to `OPENAI_API_KEY`, line ~330): `...(credentials.githubToken ? { GH_TOKEN: credentials.githubToken, GITHUB_LOGIN: credentials.githubLogin } : {})`
  - **Stale-token note:** workers are reused per conversation; a worker spawned with token T keeps T until idle-reap (≤10 min). Acceptable — document in skill. (Optionally: re-spawn worker if the token changed; defer.)
- [ ] `services/langy-agent/skills/github.md` (matches existing skill format — Purpose / When to use / Workflow / Key tools):
  - If `GH_TOKEN` unset → tell the user to connect GitHub at the settings deep link; stop.
  - Setup (once per session): `git config --global credential.helper '!gh auth git-credential'`; `git config --global user.name "$GITHUB_LOGIN"`; noreply email
  - Workflow: `gh repo clone owner/repo -- --depth 1` into `$HOME/work/` → branch → edit → commit → push → `gh pr create --title ... --body ...`
  - Hard rules: never `gh auth login`, never echo `$GH_TOKEN`, never write it to any file, clone only inside `$HOME`
- [ ] `AGENTS.md.template` — one line announcing the github capability + skill pointer
- [ ] `charts/langy-agent/templates/networkpolicy.yaml` + `values.yaml` — `networkPolicy.allowGithub` toggle. **Reality check:** the chart already ships `allowExternalHttps: true` (0.0.0.0/0:443) so GitHub works today; the new toggle matters for hardened installs that turn that off. NetworkPolicy is L3/L4 — true FQDN-bounded egress needs the issue's follow-up, document as such.

### PR 6 — Sidebar UX (chat cards + popup + acting-as chip)
*Branch `langy/github-prs-6-ux`, depends on PR 2 (endpoints) + PR 4 (structured events)*

- [ ] Structured message types in the Langy chat protocol:
  - `connect_github` — `{repoHint?, attribution: githubLogin}` → rendered as a card with a Connect button
  - `github_pr` — `{owner, repo, number, title, url, additions, deletions, authorLogin}` → rendered as a PR card
  - `status` — `{phase: "cloning"|"branching"|"committing"|"opening_pr", detail?}` → rendered as a muted progress line
- [ ] `LangyGitHubConnectCard.tsx` + `LangyGitHubPrCard.tsx` (under `langwatch/src/components/langy/`); existing `LangySidebar` switches on message type
- [ ] `useGitHubConnectPopup()` hook — opens `/api/github-langy/connect?mode=popup`, listens for `postMessage`, resolves with `{login}`; the connect card calls it on click
- [ ] After successful connect, the sidebar replays the user's last prompt automatically (so "open a PR" → connect → PR opens, all in one flow)
- [ ] "Acting as @login" chip in the sidebar footer (tRPC `langy.getGithubConnection` returns `{login} | null`); hover → Disconnect
- [ ] Tests: storybook + a scenario where the user goes connect-card → popup-resolved → PR-card without losing chat state

### PR 5 — Tests, verification, docs
*Branch `langy/github-prs-5-tests`*

- [ ] Unit: `langyGithubToken` (mock GitHub token endpoint — refresh rotation persisted, race lock, revoked → row deleted)
- [ ] Integration: connect callback upserts encrypted row; disconnect deletes + revokes; multitenancy guard accepts/blocks correctly
- [ ] Scenario test (`langwatch/src/tests/langy/`): unconnected user asks "open a PR on repo X" → judge criteria: replies with connect link, does NOT error, does NOT hallucinate a PR
- [ ] E2E on sandbox repo (manual, checklist below): real PR attributed correctly; `grep -r "$TOKEN" <worker-home>` finds nothing
- [ ] `auditLog` `langy.github.pr_created` (skill instructs Langy to report the PR URL; manager parses or app-side hook — pick simplest: log on the app side when the reply contains a PR URL, revisit later)
- [ ] Docs: `.env.example`, self-host note (App registration steps), `specs/langy/` tag flips to `@integration`

## Verification checklist (from the issue, kept live)

- [ ] User-to-server flow on a sandbox repo: 8h TTL, refresh rotation semantics, PR attribution shows the user
- [ ] Installation scoping: worker cannot reach repos outside the App installation, regardless of the user's personal access
- [ ] Token never on disk: scan worker home + clone dir for the token string after an e2e run; confirm no `.git-credentials`, no token in `.gitconfig` (credential helper reads env only)
- [ ] Idle reaper deletes the clone directory with the worker
- [ ] Multitenancy: all `UserGitHubCredential` queries filter by user AND org; guard accepts the model
- [ ] Revocation cuts off new sessions immediately; live workers hold the token ≤10 min idle-TTL (document)
- [ ] Rate limiting: 30 msg/min covers chat; decide per-user daily PR cap (proposal: 20/day, Redis counter `langy:gh:prs:${userId}:${day}`)
- [ ] NetworkPolicy: document allowExternalHttps relationship; hardened-install toggle works
- [ ] Unconnected-user UX: settings deep link in the reply
- [ ] Audit entries for connect / disconnect / PR created

## Blocked on (humans)

- [ ] **Register the GitHub App** in the LangWatch org: callback URL `<BASE_URL>/api/github-langy/callback`, "Request user authorization (OAuth) during installation" ON, token expiration ON, permissions: Contents R/W, Pull requests R/W, Metadata R. Generate client secret → `GITHUB_LANGY_*` env in deployment secrets.
- [ ] Pick the sandbox repo for e2e (suggest a throwaway `langwatch/langy-sandbox`).

## Open questions

1. Org-scoping of the credential: issue says `userId + organizationId`. A user in two orgs connects twice — intended? (Keeps installations org-bounded; yes for now.)
2. Where exactly in settings does the card live — user settings vs org integrations page? (Proposal: user-level, since the token is the user's.)
3. PR-created audit: parse reply for PR URL (cheap, lossy) vs structured tool-result reporting from worker → manager (right, bigger). Start cheap.
4. Should `modelsAllowed`-style org policy gate who may use the GitHub capability at all? (Defer; installation scoping already bounds repos.)

## Dev env / verify

```bash
# from full-langy worktree
docker compose -f compose.dev.yml up -d   # infra
cd langwatch && pnpm dev                  # app on :5560
# langy-agent locally:
node services/langy-agent/server.js
# scenario tests:
cd langwatch && pnpm vitest run src/tests/langy/
```

Conventions: CLAUDE.md, outside-in TDD from the feature file, every Prisma query includes its tenant column.
