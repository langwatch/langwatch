# Langy GitHub auth + repo access — architecture plan

Research pass 2026-07-15 (deep review of the gated-off integration + GitHub's
2026 offerings). Status: DESIGN — awaiting product decisions (§7), not built.

## 1. Current state — the crux

**It is already a GitHub App — but the code only exercises the App's
user-to-server OAuth half. It never mints installation tokens.**

- Connect flow: `src/server/routes/github-langy.ts` (`/connect` session-gated +
  signed CSRF state, `/callback` public with state verify + Redis nonce burn;
  popup + redirect modes). Helpers: `githubOauthState.ts` (HMAC state),
  `githubOauthPopupHtml.ts`, `githubOauthClient.ts`,
  `clients/github/github-oauth.*.ts`. tRPC: `langyGithub.getConnection` /
  `disconnect` only.
- Storage: Prisma `UserGitHubCredential` keyed `@@unique([userId,
  organizationId])` — per-user per-org; stores ONLY the refresh token
  (AES-256-GCM under `CREDENTIALS_SECRET`). `langyGithubToken.ts` (legacy) /
  `langy-github-credentials.service.ts` (DI successor; header names task #24)
  mint an 8h user-to-server token on demand, Redis-cached (~7h) with a rotation
  lock and `grantDead` classification (dead grant → delete row + connect card;
  transient 5xx → keep row).
- Handoff: `LangyCredentialService.getOrProvision()` folds
  `githubToken`/`githubLogin` into the credential bundle — wrapped in
  `if (LANGY_GITHUB_ENABLED)`, hard-coded `false` (`langyGithub.enabled.ts` —
  that constant IS the #24 gate). `langy-turn.service.ts` reserves a per-user
  daily PR permit only when a token exists; over-cap strips the token.
- Go: `domain/credentials.go` → `adapters/github` `Capability.Contribute()`
  emits `GH_TOKEN`+`GITHUB_LOGIN` into the worker env at spawn. Probe carries a
  boolean only. Worker skill wires `gh auth git-credential`; clone in
  `$HOME/work`, reaped ≤10min.
- **Confirmed gaps**: no `GITHUB_LANGY_PRIVATE_KEY` env (no PEM ⇒ installation
  tokens impossible today), no `Installation` model, no installation webhook.

Reusable as-is: OAuth route shape + state signing + popup + connect card,
Redis lock/cache helpers, credential-handoff seam, the Go `Capability` seam
(wants a `GH_TOKEN`, doesn't care whence), permit/rate-limit, audit actions.

## 2. GitHub mechanics this hinges on (2026)

- Installation access tokens can be **scoped down at mint time**:
  `POST /app/installations/{id}/access_tokens` takes `repository_ids` (≤500)
  AND a `permissions` subset; cannot exceed the installation's grant. **TTL
  fixed at 1 hour.**
- Minting requires an app JWT: RS256 with the app private key, exp ≤10min.
- The 2026-05-15 per-request override header is format-only, NOT downscoping —
  per-turn least privilege means minting per turn.
- Attribution: installation-token activity = the app bot; user-to-server
  activity = the user + app badge.
- Nuance: a GitHub App user-to-server token is already installation-bounded
  (NOT the user's full GitHub, unlike a classic OAuth App). Its weakness is
  narrower: all repos in the installation, 8h.
- Self-hosting: the App Manifest flow one-click-creates an app and returns
  `id`, `pem`, `client_secret`, `webhook_secret`.
- Industry norm (Devin): bot-authored PRs; never act as the user without
  explicit initiation. Cursor's silent co-author injection = anti-pattern.

## 3. Recommended architecture

**Per-turn, per-repo, 1h installation token, minted in the control plane** —
replaces the broad 8h user token in the worker. Maps directly onto the parked
"credential crucible" (JIT tokens over env vars).

Connect: Settings → "Install" → `github.com/apps/<slug>/installations/new`
with signed state → GitHub setup callback → upsert
`LangyGithubInstallation{installationId → org}`. Optional user-to-server OAuth
ONLY if user-attributed PRs ship.

Per turn: resolve installation for (org, repo) → verify repo ∈ installation →
sign app JWT → mint token `{repository_ids: [one repo], permissions:
{contents: write, pull_requests: write}}` → inject as `GH_TOKEN` (Go
unchanged).

Attribution (recommended default): **bot-authored** PR/commits with
`Co-authored-by: <login> <id+login@users.noreply.github.com>` and "Requested by
@user via LangWatch" in the body. Needs no user OAuth at all. Opt-in
"attribute to me": worker pushes with the installation token; the CONTROL
PLANE holds the user token and makes the final PR-create call — the broad
token never enters the sandbox.

Token delivery: (1) ship spawn-env with the target repo added to the worker
credential signature (re-warm on repo change); (2) evolve to JIT — a `gh`
credential-helper calls back over the authenticated manager channel at clone
time; control plane mints on demand.

## 4. Change map (file-level)

- `env-create.mjs`: + `GITHUB_LANGY_PRIVATE_KEY` (PEM), +
  `GITHUB_LANGY_WEBHOOK_SECRET` (both optional; feature off without them).
- New `langyGithubAppToken.ts`: app JWT signer (`jsonwebtoken`, already a dep)
  + `mintInstallationToken({installationId, repositoryIds, permissions})`,
  Redis cache per (installation, repo) under 1h TTL, existing lock helpers.
- `routes/github-langy.ts` (or sibling): install callback
  (`setup_action=install`, `installation_id`, signed state) → upsert mapping.
- `routes/webhooks.ts`: verify webhook secret; handle `installation`,
  `installation_repositories`, `installation_target` → keep mapping fresh.
- `LangyCredentialService.ts`: swap `getAccessToken(user, org)` for the
  installation mint keyed (org, repo); flip `LANGY_GITHUB_ENABLED` (that IS #24).
- `langy-turn.service.ts`: repo resolution before mint; repo in signature.
- tRPC `langyGithubRouter`: `listInstallations`/`listRepos`/`getInstallStatus`;
  disconnect = uninstall deep-link.
- DB: `LangyGithubInstallation{installationId, accountLogin, accountType,
  organizationId, repoSelection, suspended, timestamps;
  @@unique([installationId]); @@index([organizationId])}`. Repo list cached or
  fetched via `GET /installation/repositories`.
- Settings UI: GitHub integrations page (read scope-selector/drawers best
  practices first); connect card copy: "Install the LangWatch app on the repos
  Langy may touch."
- If bot-attribution: DELETE `langyGithubToken.ts`, the refresh machinery,
  `UserGitHubCredential` (+repo). No compat re-exports. Docs: rewrite
  `docs/langy-github-app.md`; `specs/langy/langy-github-prs.feature` already
  assumes installation semantics.
- Go: unchanged for delivery (1); JIT (2) adds a mint-callback endpoint + the
  credential helper.

## 5. Blast radius (leaked worker token)

| | Today (user-to-server) | Recommended (installation) |
|---|---|---|
| Scope | all repos in installation(s) | ONE repo |
| Permissions | installation grant | contents:write + pull_requests:write only |
| Lifetime | 8h | 1h, self-expiring |
| At rest | encrypted refresh token in DB | nothing — minted on demand |
| Revocation | delete row, live worker ≤10min | self-expires; uninstall/remove repo kills next mint |
| Crown jewel | `CREDENTIALS_SECRET` | app PRIVATE KEY — control plane only, never near the worker |

## 6. Migration

1. Env (PEM + webhook secret) + JWT signer + mint module.
2. `LangyGithubInstallation` + install callback + webhook; backfill via
   `GET /app/installations`.
3. Repoint `LangyCredentialService`; flip the gate.
4. Attribution decision → delete or relocate the user-token machinery.
5. Reuse untouched: state signing, popup, connect card (recopy), permits,
   audit, Go capability.

## 7. Open product decisions

1. Attribution: bot + Co-authored-by (default; deletes most code) vs opt-in
   user-attributed via control-plane-held token.
2. Repo-picker UX: explicit picker vs agent-infers + control-plane-validates.
3. Token delivery: spawn-env + repo-in-signature first vs JIT credential
   helper (the crucible).
4. Self-hosted: App Manifest one-click flow vs manual registration doc.
5. Org↔installation mapping cardinality (drives schema + settings UX).

Sources: GitHub docs — installation access token, app JWT, auth as
installation, auth on behalf of a user, per-request override changelog
(2026-05-15), App Manifest flow; Devin review docs.
