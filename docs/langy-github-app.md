# Langy → GitHub App setup

This is the deployment-time guide for the per-user GitHub App that Langy uses
to open pull requests attributed to the requesting user (issue
[#4747](https://github.com/langwatch/langwatch/issues/4747)). The code is
already merged; this doc is what someone with org-admin access needs to do
once per environment.

> **TL;DR.** Register a GitHub App in the LangWatch org, drop three secrets
> into the deployment env, install the App on the repos Langy may touch, and
> users see "Connect GitHub" in the Langy sidebar.

## 0. Enabling Langy in the chart

The Langy agent pod is **default OFF** in the umbrella chart
(`langy-agent.chartManaged: false`). This is deliberate: the agent + app
Deployments both reference a shared `LANGY_INTERNAL_SECRET` Secret that the
chart does NOT materialise (it's created out-of-band — Terraform / external
secrets / a manual `kubectl create secret`). Defaulting on would break the
main app pod for every existing operator's next upgrade with
`CreateContainerConfigError`.

To turn Langy on:

```bash
# 1. Create the shared Bearer secret the app + agent use to authenticate to
#    each other. 64 hex chars is plenty.
kubectl -n langwatch create secret generic langwatch-langy-agent-auth \
  --from-literal=LANGY_INTERNAL_SECRET="$(openssl rand -hex 32)"

# 2. Opt the agent in. The app deployment will then pick up
#    OPENCODE_AGENT_URL + LANGY_INTERNAL_SECRET automatically.
helm upgrade langwatch ./charts/langwatch -n langwatch \
  -f values.prod.yaml \
  --set langy-agent.chartManaged=true
```

Even with the agent running, **the in-product UI stays staff-only** until
`release_langy_enabled` is flipped on for the users / orgs you want to roll
out to (see PostHog or `/ops/feature-flags`). The chart-managed switch only
controls the runtime; the feature flag controls user-facing exposure.

## 1. Register the App

GitHub → org settings → Developer settings → **GitHub Apps** → **New GitHub App**.

| Field | Value |
|---|---|
| App name | `LangWatch Langy` (or per environment, e.g. `LangWatch Langy (dev)`) |
| Homepage URL | `https://app.langwatch.ai` (or your control-plane URL) |
| **User authorization callback URL** | `<BASE_URL>/api/github-langy/callback` |
| **Request user authorization (OAuth) during installation** | **ON** |
| **Expire user authorization tokens** | **ON** |
| **Webhook → Active** | **OFF** (Langy doesn't subscribe to events here) |
| **Where can this GitHub App be installed?** | Any account (recommended) or only this org |

**Repository permissions:**

| Permission | Access |
|---|---|
| Contents | Read & write |
| Pull requests | Read & write |
| Metadata | Read |

Don't grant anything else. Tighter scope = smaller blast radius if a refresh
token leaks. The token TTL (8h) plus single-use refresh rotation does the rest.

Click **Create GitHub App**. On the resulting page:
- copy the **App ID**
- copy the **Client ID**
- **Generate a new client secret** and copy it

## 2. Plumb the secrets

Add to the control-plane env (`.env`, `values.yaml`, secret manager — whatever
your deploy uses):

```sh
GITHUB_LANGY_APP_ID="<App ID from step 1>"
GITHUB_LANGY_CLIENT_ID="<Client ID from step 1>"
GITHUB_LANGY_CLIENT_SECRET="<Client secret from step 1>"
```

All three are optional in the schema (`langwatch/src/env-create.mjs`). When
unset, the GitHub feature is silently off — the Connect card never appears
and `langyGithubToken.getGithubTokenForUser` short-circuits to `null`. That
keeps installs that don't want this feature clean.

`CREDENTIALS_SECRET` (already required for any production install) is reused
to AES-256-GCM the stored refresh token; nothing new needed there.

## 3. Install the App

Either the org admin or an individual user can install the App on the repos
Langy should be able to touch. The installation IS the access boundary: Langy
can only open PRs in repos where (a) the user has authorized the App and
(b) the App is installed.

When a user clicks "Connect GitHub" in the Langy sidebar and the App isn't
installed anywhere yet, GitHub walks them through the install at the same
time as the OAuth consent.

## 4. NetworkPolicy / egress

The Langy agent's stock chart (`charts/langy-agent`) ships with
`networkPolicy.allowExternalHttps: true`, which allows `0.0.0.0/0:443` —
`github.com`, `api.github.com`, and `codeload.github.com` work without
further changes.

In hardened installs that flip `allowExternalHttps` to `false`, add a
GitHub-specific egress rule. NetworkPolicy is L3/L4, so FQDN bounding isn't
possible without an extra controller; the simplest tightening is to keep
`allowExternalHttps: true` for the agent pod specifically (other workloads
can tighten independently), or use a CNI like Cilium that supports FQDN
egress and add `github.com` + `api.github.com` + `codeload.github.com` to
the allow-list.

## 5. Verify

In a session, ask Langy something like "open a PR on `<a repo you've granted
the App access to>`". You should see:

1. The "Connect GitHub" card in chat (if you haven't connected yet).
2. After clicking Connect and authorizing, the popup closes and the chat
   continues with "Connected as @yourlogin".
3. Langy clones the repo into the per-session worker home, branches, commits,
   pushes, and posts the PR URL — rendered as a PR card.

If anything goes wrong, the audit log (`langy.github.connect`,
`langy.github.disconnect`) and Sentry capture the failure paths.

## Operational notes

- **Token in worker, not on disk.** Workers receive the access token via
  `GH_TOKEN` env. The `github.md` skill wires
  `git config credential.helper '!gh auth git-credential'` so git pushes read
  it from env — no `.gitconfig`, no `.git-credentials`. The clone directory
  lives inside the per-worker home that the idle reaper deletes (≤10 min).
- **Sticky worker tokens.** A worker spawned with token T keeps T until the
  idle reaper kills it. Revocation cuts off **new** sessions immediately; a
  live worker may hold a token for up to the idle TTL. This is intentional
  (≤10 min worst case) — documented in the spec.
- **Refresh-token rotation.** GitHub rotates the refresh token on every use.
  We persist the rotated token inside a Redis lock so two parallel chats from
  the same user can't burn the single-use grant.
- **Disconnect.** Settings → Integrations → Disconnect (or the chip in the
  Langy sidebar). Deletes the row and best-effort revokes the grant at
  GitHub. The grant-revocation call requires the user's access token, which
  we don't store; the local delete is the source of truth.
