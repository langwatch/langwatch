# Boxd preview — migrate ownership to a machine user (deferred)

**Status on 2026-04-24:** deferred by Drew. Filed as a follow-up to capture the design so the migration isn't reinvented later.

## Why this exists

The v1 preview workflow authenticates to Boxd using an SSH key paired to **Drew's personal Boxd account** (secret: `BOXD_SSH_KEY`). That's a deliberate shortcut: it ships v1 in ~5 minutes of setup with no new GitHub account, email mailbox, or 2FA vault entry.

The cost of that shortcut is ownership:

- The staging VM, every `pr<N>` fork, and the CI key all live under Drew's personal Boxd account.
- Destroying that account (role change, leaving the company, revocation) destroys the preview system.
- Boxd seat quota (10 VMs) is shared with Drew's personal dev VMs. Contention between `orchard` / `orchard-rs` / ad-hoc dev VMs and `pr<N>` previews is real.

The migration target is a **machine-user-owned Boxd account** — a dedicated GitHub user whose email is `user-test-agent@langwatch.ai` (already available as an org-controlled mailbox). That account owns the staging VM and all previews; CI uses a second SSH key paired to the machine user's Boxd account.

## Machine user vs "real bot" — the terminology

GitHub's proper bot primitive is a **GitHub App** (private key + installation token + OIDC JWT). Boxd does not accept GitHub Apps or OIDC — Boxd's only sign-up path is OAuth-with-a-GitHub-user-identity. So "machine user" — a regular GitHub user account dedicated to automation — is the closest thing to a bot on the Boxd side. GitHub's own docs use this term.

If Boxd ever ships OIDC federation, revisit this doc; the migration target changes to "the workflow presents a GitHub OIDC id-token, Boxd verifies and issues a scoped credential, no stored secrets." See the "workflow-identity-federation" adversarial-debate note in the original research doc.

## Trigger conditions (when to do this)

Any of:

- Second engineer joins the preview flow and needs their own VMs (personal-account slot contention becomes real).
- Drew's role changes, or Drew plans to leave, or revocation becomes a real concern.
- Boxd quota bump gets approved — worth migrating so the bump lands on a org-owned identity.
- Boxd ships OIDC / team accounts — migrate directly to whatever primitive they launch.

None of these apply on 2026-04-24. Revisit at the next quarterly infrastructure review.

## Migration plan

### 1. Create the machine-user GitHub account (~10 min)

Human-only work; see steps in `docs/research/2026-04-24-boxd-pr-preview-bootstrap.md` for the detailed click-path. Summary:

- Sign up at github.com/signup with `user-test-agent@langwatch.ai`.
- Username: `user-test-agent` (or `user-test-agent-langwatch` if taken).
- Strong password in 1Password team vault, TOTP seed stored alongside, recovery codes stored alongside.
- Add to `langwatch/langwatch` with **Read** permission. The machine user doesn't need to push.

### 2. Create the machine user's Boxd account (~3 min)

- Sign in to `boxd.sh/app` in an incognito window, authenticate with GitHub as `user-test-agent`.
- First `ssh boxd.sh` from a laptop (as `user-test-agent`, with a fresh ed25519 keypair) links the key to the new account.

### 3. Recreate the staging VM under the machine user (~30 min)

Because Boxd has no cross-account VM sharing (verified 2026-04-21 against `docs.boxd.sh/llms-full.txt`), you can't transfer the existing `langwatch-main-golden-image` (or `langwatch-staging`) from Drew's account to the machine user's account.

Practical path: on the machine user's account, run a bootstrap script that creates a fresh VM and clones + builds langwatch. Options:

- **Manual:** `boxd new --name=langwatch-staging` as the machine user, SSH in, clone langwatch, run `make dev-scenarios` (or whichever compose profile staging tracks), wait for health.
- **Scripted (preferred):** the missing "bootstrap from empty VM" script identified as tech debt in the v1 bootstrap doc. Worth building before migration — also unblocks a destroy-and-recreate staging refresh schedule.

### 4. Swap the CI credential (~2 min)

- Generate a new ed25519 keypair on the machine user's account.
- `gh secret set BOXD_SSH_KEY --repo langwatch/langwatch < new-key` (overwrites).
- Update `env.STAGING_VM` in `.github/workflows/boxd-pr-preview.yml` if the new VM has a different name.

### 5. Reap Drew's preview VMs (~2 min)

From Drew's account:

```bash
boxd list --json | jq -r '.[] | select(.name | test("^pr[0-9]+$")) | .name' \
  | xargs -I {} boxd destroy {} -y
boxd destroy langwatch-main-golden-image -y  # or langwatch-staging, whichever name
```

After this, Drew's account has only the personal VMs (`orchard`, etc.) and the preview footprint is fully under the machine user.

## Risks to flag at migration time

- **Seat cost.** GitHub charges for users in private repos on paid plans. Confirm cost impact before signup.
- **2FA recovery.** The machine user's TOTP seed must be in the team vault, not a personal authenticator. Anything else is a bus-factor trap.
- **Boxd account-linking flow.** Step 2 requires a browser login; if Boxd ever tightens bot-detection (CAPTCHA on sign-up, phone verify, etc.), the migration needs a real-human browser session. Don't scope this to "can be done by automation."
- **Downtime during bootstrap.** The machine user's staging VM has no warm state — until it boots and compose-ups, previews can't fork. If the migration is done mid-week, expect previews to be unavailable for the duration of step 3.

## Out of scope for this migration

- Moving ownership to a **GitHub App** — requires Boxd to ship the receiving side (OIDC or App installation tokens). See challenge output in the original research doc; refile if that ships.
- Setting up a **controller VM** that accepts GitHub OIDC tokens and proxies to Boxd from inside the boxd network. More complex than the machine-user path, explored in the design investigation. Keep on the shelf for when the SSH-key-in-secrets model feels fragile.
