# Langy → GitHub App setup

This is the deployment-time guide for the GitHub App that Langy uses to open
**bot-authored** pull requests on the repositories an organization installs it
on (issue [#4747](https://github.com/langwatch/langwatch/issues/4747)). PRs are
authored by the app and credit the requesting user via a `Co-authored-by`
trailer and a "Requested by @&lt;login&gt; via LangWatch" note in the body. There is
no per-user OAuth and no stored token — the app private key is the only
credential, it lives only in the control-plane env, and 1-hour installation
tokens are minted on demand and never persisted.

> **TL;DR.** Register a GitHub App, drop its id + private key + webhook secret +
> slug into the deployment env, and org admins install it on the repos Langy may
> touch from Settings → Integrations.

## 0. Enabling Langy in the chart

The Langy agent pod is **default OFF** in the umbrella chart
(`langyagent.chartManaged: false`). This is deliberate: the agent + app
Deployments both reference a shared `LANGY_INTERNAL_SECRET` Secret that the
chart does NOT materialise (it's created out-of-band — Terraform / external
secrets / a manual `kubectl create secret`). Defaulting on would break the
main app pod for every existing operator's next upgrade with
`CreateContainerConfigError`.

To turn Langy on:

```bash
# 1. Create the shared Bearer secret the app + agent use to authenticate to
#    each other. 64 hex chars is plenty.
kubectl -n langwatch create secret generic langwatch-langyagent-auth \
  --from-literal=LANGY_INTERNAL_SECRET="$(openssl rand -hex 32)"

# 2. Opt the agent in. The app deployment will then pick up
#    OPENCODE_AGENT_URL + LANGY_INTERNAL_SECRET automatically.
helm upgrade langwatch ./charts/langwatch -n langwatch \
  -f values.prod.yaml \
  --set langyagent.chartManaged=true
```

Even with the agent running, **the in-product UI stays staff-only** until
`release_langy_enabled` is flipped on for the users / orgs you want to roll
out to (see PostHog or `/ops/feature-flags`). The chart-managed switch only
controls the runtime; the feature flag controls user-facing exposure.

## 1. Register the App

GitHub → org settings → Developer settings → **GitHub Apps** → **New GitHub App**.
(Self-hosted registration is manual for now — the App Manifest one-click flow is
a deferred follow-up.)

| Field | Value |
|---|---|
| App name | `LangWatch Langy` (or per environment, e.g. `LangWatch Langy (dev)`) |
| Homepage URL | `https://app.langwatch.ai` (or your control-plane URL) |
| **Setup URL** | `<BASE_URL>/api/github-langy/setup` |
| **Redirect on update** | ON (so re-configuring an install returns to Setup URL) |
| **Request user authorization (OAuth) during installation** | OFF — Langy is bot-authored, no user OAuth |
| **Webhook → Active** | **ON** |
| **Webhook URL** | `<BASE_URL>/api/github-langy/webhook` |
| **Webhook secret** | generate one (`openssl rand -hex 32`) — you'll set it as `GITHUB_LANGY_WEBHOOK_SECRET` |
| **Where can this GitHub App be installed?** | Any account (recommended) or only this org |

**Repository permissions** (nothing else — tighter scope = smaller blast radius):

| Permission | Access |
|---|---|
| Contents | Read & write |
| Pull requests | Read & write |
| Metadata | Read |

**Subscribe to events**: none required beyond the installation lifecycle, which
GitHub sends automatically (`installation`, `installation_repositories`).

Click **Create GitHub App**. On the resulting page:
- copy the **App ID**
- note the **app slug** (in the app's URL: `github.com/apps/<slug>`)
- **Generate a private key** and download the `.pem`

## 2. Plumb the secrets

Add to the control-plane env (`.env`, `values.yaml`, secret manager — whatever
your deploy uses). All are optional in the schema
(`platform/app/src/env-create.mjs`); when the **private key** is unset the feature
is silently off — the connect card says the integration is unavailable and no
token can be minted.

```sh
GITHUB_LANGY_APP_ID="<App ID from step 1>"
GITHUB_LANGY_APP_SLUG="<app slug from the app URL>"
GITHUB_LANGY_WEBHOOK_SECRET="<the webhook secret you generated>"
# The private key PEM. In a single-line env value, escape newlines as \n —
# the token service normalises them back.
GITHUB_LANGY_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
```

There is **no client id / secret** — the bot-authored flow uses no user OAuth.
`CREDENTIALS_SECRET` (already required for any production install) signs the
install round-trip's state; nothing new needed there.

## 3. Install the App

An org admin installs the app from **Settings → Integrations → GitHub → Install
the LangWatch GitHub App**, or from the in-chat card the first time Langy needs
GitHub access. GitHub walks them through choosing the repositories, then
redirects to the Setup URL, which records the installation against their
LangWatch organization.

The installation IS the access boundary: Langy can only open PRs on repositories
the app is installed on. A single LangWatch organization can install the app on
several GitHub accounts (each installation is listed separately in settings).

## 4. NetworkPolicy / egress

The Langy agent's stock chart (`infra/charts/langyagent`) ships with
`networkPolicy.allowExternalHttps: true`, which allows `0.0.0.0/0:443` —
`github.com`, `api.github.com`, and `codeload.github.com` work without further
changes. Hardened installs that flip `allowExternalHttps` to `false` should add
those three FQDNs to the agent pod's egress allow-list (see ADR-043 and
`specs/langy/langy-egress-enforcement.feature`). The control plane also reaches
`api.github.com` to mint installation tokens and read installation metadata.

## 5. Verify

In a session (with `release_langy_enabled` on for you), ask Langy something like
"open a PR on `<a repo the app is installed on>`". You should see:

1. The "Install the LangWatch GitHub App" card in chat (if the org hasn't
   installed it yet).
2. After installing, the popup closes and the chat continues.
3. Langy clones the repo into the per-session worker home, branches, commits,
   pushes, and posts the PR URL — rendered as a PR card. The PR is authored by
   the app, with the requester credited as co-author.

If anything goes wrong, the audit log (`langy.github.install`,
`langy.github.disconnect`) and Sentry capture the failure paths.

## Operational notes

- **Token in worker, not on disk.** Workers receive a 1-hour installation token
  via `GH_TOKEN` env. The github skill wires
  `git config credential.helper '!gh auth git-credential'` so git pushes read it
  from env — no `.gitconfig`, no `.git-credentials`. The clone directory lives
  inside the per-worker home the idle reaper deletes (≤10 min).
- **Nothing at rest.** No token or refresh token is stored control-plane side.
  The app private key is the only credential; it never leaves the control plane
  and never goes near a worker. Tokens are minted per turn, cached in Redis a
  hair under their 1h lifetime, and self-expire.
- **Least privilege at mint time.** Tokens are minted with only
  `contents:write` + `pull_requests:write`, scoped to the installation's
  repositories (or a single repository when the turn targets one).
- **Sticky worker tokens.** A worker spawned with token T keeps T until the idle
  reaper kills it. Removing the installation cuts off **new** turns immediately;
  a live worker may hold a token for up to the idle TTL (≤10 min) or until it
  self-expires (≤1h). Documented in the spec.
- **Disconnect.** Settings → Integrations → Disconnect opens GitHub's uninstall
  page (GitHub can't be uninstalled via the API). Once GitHub confirms, the
  `installation.deleted` webhook removes the local record.
