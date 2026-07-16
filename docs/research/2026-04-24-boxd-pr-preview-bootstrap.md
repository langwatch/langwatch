# Boxd PR preview — activation checklist

**For:** `.github/workflows/boxd-pr-preview.yml`
**Status on 2026-04-24:** workflow committed, **not yet activated**. This doc is the ordered list of things that must exist before the workflow does anything useful on a real PR.

The workflow is a no-op until all preconditions below are satisfied. Opening a PR before then will either (a) fail at SSH setup (missing secret), (b) fail at fork (missing/mis-named staging VM), or (c) succeed at fork but fail the health probe (env overrides not wired).

## Preconditions (do these in order)

### 1. Pair the CI SSH key to Drew's Boxd account (~2 min)

The keypair was generated on `orchard:/tmp/boxd-ci-bot`. Copy it to your laptop first:

```bash
# from your laptop
mkdir -p ~/.ssh
scp orchard.boxd.sh:/tmp/boxd-ci-bot      ~/.ssh/boxd-ci-bot
scp orchard.boxd.sh:/tmp/boxd-ci-bot.pub  ~/.ssh/boxd-ci-bot.pub
chmod 600 ~/.ssh/boxd-ci-bot
```

(Or use `boxd cp orchard:/tmp/boxd-ci-bot ~/.ssh/boxd-ci-bot` if you're signed in to Boxd as yourself on your laptop.)

Then pair the key to your existing Boxd account. First SSH connection with the new key triggers the link flow:

```bash
ssh -i ~/.ssh/boxd-ci-bot boxd.sh whoami
```

It will print a URL. Open it in the **same browser** where you're already signed in to `boxd.sh/app` as yourself. Confirm the link. Re-run the command — it should now return your identity.

Verify both keys are attached:

```bash
ssh boxd.sh whoami --json   # your normal key
ssh -i ~/.ssh/boxd-ci-bot boxd.sh whoami --json   # CI key
# Both should list the same account with both SSH fingerprints.
```

### 2. Store the private key as a repo secret (~1 min)

```bash
gh secret set BOXD_SSH_KEY --repo langwatch/langwatch < ~/.ssh/boxd-ci-bot
gh secret list --repo langwatch/langwatch | grep BOXD_SSH_KEY
```

Then destroy the copy on orchard and keep only the versions in 1Password + repo secrets:

```bash
ssh orchard.boxd.sh 'rm /tmp/boxd-ci-bot /tmp/boxd-ci-bot.pub'
```

Also save `~/.ssh/boxd-ci-bot` to 1Password as "Boxd — CI SSH key (Drew's account)" so the key isn't only on your laptop.

### 3. Confirm the staging VM name (rename if desired)

The workflow reads `env.STAGING_VM: langwatch-main-golden-image` at the top of `boxd-pr-preview.yml`. This matches the existing VM name. If/when you rename the VM to `langwatch-staging` (to match the naming convention agreed in the design doc), update that env var in the workflow file and merge as a one-line PR.

Renaming via Boxd isn't a first-class primitive; the practical path is `boxd fork langwatch-main-golden-image --name langwatch-staging && boxd destroy langwatch-main-golden-image -y`, which burns a VM slot briefly. Optional; v1 works fine with the current name.

### 4. First-run smoke test (~10 min)

Before merging this branch, kick the tires:

```bash
# In the worktree, push the branch up
git push -u origin issue3433/boxd-pr-preview-workflow
# Open a draft PR against main — the workflow runs on the PR itself
gh pr create --draft --title "feat(ci): per-PR Boxd preview VMs" --body "Closes #3433"
```

The first PR becomes its own smoke test — the workflow should fork staging into `pr<N>` where `<N>` is this PR's number, boot the LangWatch stack with the override env, and comment the preview URL. Watch the Actions tab, read the logs, measure:

- Time spent in each step (fork / boot / health / total wall-clock)
- Whether the health probe's `HTTP 200/302/307` check is too loose (e.g., Next.js might return 200 while Clickhouse is still replaying — if you see a "200 but broken" preview, tighten the probe to a domain-level endpoint like `/api/health` or an auth'd read)
- Whether FIFO eviction behaves right at the soft cap (test by opening a 5th and 6th PR — 5th fits, 6th evicts)

If the smoke test passes, mark PR ready for review and merge. From that point the workflow is live.

## Post-activation follow-ups (known debt, not blockers)

- **Full-rebuild path for staging.** The current `refresh-staging` job does `git reset --hard origin/main && compose up --build` on the live VM. Over time this accumulates docker cache, log bloat, and potentially migration-history drift. Design doc recommends destroy-and-recreate on a schedule (e.g., weekly) but we haven't built the "bootstrap from empty VM" script yet. File a tech-debt issue when this starts to bite.
- **Health probe tightness.** Currently `curl $url/` with 200/302/307 OK. Consider `curl $url/api/health` once that endpoint exists and returns status from Clickhouse, Postgres, ES readiness.
- **OAuth providers on previews.** `compose.dev.yml` sets `NEXTAUTH_PROVIDER: email` so Auth0/Okta aren't needed for previews. If someone changes that default, callback URL registration becomes a per-fork problem — or add `https://*.boxd.sh/api/auth/callback/*` as a wildcard to a staging OAuth app.
- **Machine-user migration.** Tracked as a follow-up — see `docs/research/2026-04-24-boxd-preview-machine-user-migration.md`. Deferred by Drew; revisit when team grows or ownership needs to move off a personal account.

## Rollback

If the workflow misbehaves after activation:

1. **Immediate:** disable the workflow run — `gh workflow disable "Boxd PR preview" --repo langwatch/langwatch`.
2. **Clean up leaked VMs:** `boxd list --json | jq -r '.[] | select(.name | test("^pr[0-9]+$")) | .name' | xargs -I {} boxd destroy {} -y`.
3. **Revert the workflow file** via a fast-forward PR.

There's nothing else to unwind — the workflow's blast radius is the set of `pr<N>` VMs it creates, which the destroy step removes.
