---
name: githubsim
description: "Test the GitHub App, repositories, pull requests and webhooks locally with githubsim, haven's GitHub stand-in: install page, installation tokens, scripted 401/403/404/422/429/5xx, signed webhooks, OAuth. Use when someone says 'haven github', 'githubsim', 'haven up +github', 'haven sim github', 'connect GitHub locally', 'fake GitHub App', 'GitHub rate limit', 'send a pull_request webhook', 'GH-01', 'CA-15', 'LANGY-09', or needs a PR to merge without a real repository."
user-invocable: true
---

# githubsim

Answers the GitHub calls the github module makes, serves the App install page, and sends
HMAC-signed webhooks to the stack. Code: `services/sims/githubsim`, spec
`specs/setup/github-simulator.feature`. It checks no JWT signature (the App id in the
claims and expiry only). Console: `https://github.<slug>.langwatch.localhost` (a plain page:
installations, pull requests, fault count).

## Run it

- Opt-in: `haven up +github` (sticky; restarts the stack). Runs in the `go` lane by default (see `sims`).
- The overlay sets `GITHUB_LANGY_APP_ID`, `_APP_SLUG`, `_PRIVATE_KEY` (a throwaway RSA key),
  `_WEBHOOK_SECRET`, and the two origin leaves `GITHUB_LANGY_API_BASE` and
  `GITHUB_LANGY_WEB_BASE` (both the sim). With `+github` the whole set beats a
  real `GITHUB_LANGY_*` App in `.env` (unlike Stripe, where `.env` wins); drop `+github` to use your own.
- The sim is told the stack's `/api/github/webhook` and `/api/github/setup` and the same secret.
- Seeded: installation `1001` on `langwatch-demo` with repos `langwatch-demo/app`,
  `langwatch-demo/docs`, and PR `#1` on `feat/demo`. User `octocat`.
- Social sign-in with GitHub is the IdP overlay's job, not the GitHub App's: with idpsim on, the
  stack gets `GITHUB_SIGN_IN_BASE` pointing at idpsim (`tools/thuishaven/domain/overlay_idp_social.go`;
  see `idpsim`). This sim's OAuth routes below serve the GitHub App flow.

## What it fakes

```
GET  /app/installations/{id}                       App JWT
POST /app/installations/{id}/access_tokens         App JWT; 422 for a permission not granted
GET  /installation/repositories                    token; paged
GET|POST /repos/{o}/{r}/pulls   GET .../pulls/{n}   head=owner:branch, state=
POST|GET /repos/{o}/{r}/check-runs | commits/{sha}/check-runs
GET  /apps/{slug}/installations/new?account=<login>&state=…   redirects to the setup URL
GET  /login/oauth/authorize | POST /login/oauth/access_token | GET /user, /user/emails
```

`/github-apps/{slug}/installations/new` is the same page. Without `account` it lists accounts.

For gh and git (what Langy's worker runs): every REST route above also answers under `/api/v3`;
`POST /api/graphql` answers gh's `RepositoryInfo`, `PullRequestForBranch` and `PullRequestCreate`
(a repo outside the token's installation is GitHub's `NOT_FOUND`); `GET /{o}/{r}.git/info/refs`,
`git-upload-pack` and `git-receive-pack` serve clone and push over a bare repo per repository
(README on `main`; token as the Basic password; `GITHUBSIM_GIT_ROOT`, default a temp dir).

## Drive it

```bash
haven sim github status | list | pulls | calls | deliveries --json
haven sim github install --account acme --deliver        # new installation + signed webhook
haven sim github pr open --repo langwatch-demo/app --head feat/x --deliver
haven sim github pr merge --repo langwatch-demo/app --number 1 --deliver
haven sim github app suspend|unsuspend|delete|add-repo|remove-repo --installation 1001 --deliver
haven sim github deliver --event pull_request --action closed --repo langwatch-demo/app --number 1 [--bad-signature|--omit-signature]
haven sim github fault add --status 429 --retry-after 30 --match /pulls --times 1
haven sim github fault list | clear      haven sim github clear | reset
```

`--match` is a substring of `METHOD /path`. Faults answer GitHub's JSON error body;
429 and 403-with-Retry-After set `X-RateLimit-Remaining: 0`. `POST /_sim/api/tokens/expire`
makes every minted token answer 401. Without haven: `make service svc=githubsim`
(:5596; `GITHUBSIM_WEBHOOK_URL`, `_WEBHOOK_SECRET`, `_SETUP_URL`, `_APP_ID`, `_SEED=1`).

## Row recipes

- GH-01/GH-02/GH-F1: Settings > Integrations > Connect; the popup lands on the sim's install
  page; click an account; the setup redirect returns and the connected state shows.
- GH-11: an installation made with `haven sim github install` before the connect flow is refused
  (not-from-flow). Connect through `/api/github/install?organizationId=<org>` first, then
  `haven sim github app add-repo --installation <id> --repo big/rN` for 150 repos (one repo per call, so loop).
- GH-13/GH-31: `app delete --installation <id> --deliver`, then reconnect; PR history stays.
- GH-15: do not select `+github` and leave `GITHUB_LANGY_APP_ID` unset.
- CA-15/CA-41: `pr open|merge --deliver` then the Pull Requests page; `fault add --status 429
--retry-after 30 --match /pulls` for the snapshot-on-rate-limit state.
- CA-21/CA-37/CA-38/CA-40/CA-42: a PR whose `--head` equals the coding session's branch,
  opened with `--deliver`, binds usage to the project. Pass `host=github.com` to the PR usage APIs
  when PRs were stored before `+github`: the default host is now the githubsim host.
- LANGY-09/LANGY-45: with `+github +langy` haven sets `LANGY_GITHUB_HOST` to the sim, so the
  worker's gh and git reach it (GH_HOST, GH_ENTERPRISE_TOKEN, a git rewrite of github.com).
  Script the turn with llmsim `/tool bash` lines (gpt-5-mini in the composer). gh drops the port
  from a git remote, so in a clone run `gh pr create -R "$GH_HOST/<owner>/<repo>" --head <branch>`.
  The worker's `$HOME/work` goes when the worker idles out (2 min on the host tier): one turn per flow.
