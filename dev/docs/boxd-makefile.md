# boxd workflows (`boxd.mk`)

`boxd.mk` is a Makefile of multi-step orchestration over the [boxd](https://docs.boxd.sh) CLI. It exists for flows that need more than one boxd command — single-command operations stay on the CLI.

> **Targets here orchestrate multi-step flows. For single-command operations, use the `boxd` CLI directly.**

If you find yourself adding a target that wraps a single `boxd ...` call, don't — that's maintenance debt for no value. The exception (and only exception) is `boxd-connect-*`, which centralizes the slug → VM-name → tmux-session-name resolution shared with the fork-* targets.

## Prerequisites

- `boxd` CLI on `$PATH` (use the external CLI on your laptop; this Makefile is invoked from your local checkout, not from inside a VM).
- `gh` CLI authenticated (`gh auth status`) — needed to resolve PR head refs and issue titles.
- A working git checkout of `langwatch/langwatch`.
- (Recommended) a `<namespace>--langwatch-golden` VM, created once via `make boxd-golden`. The namespace defaults to your `gh api user --jq .login` (or `whoami` if gh is unavailable). Override with `BOXD_NAMESPACE=<name>` for shared/team-owned goldens.

## Quick reference

```
make boxd-help                       # full target list with one-line descriptions
make boxd-golden                     # create the canonical base VM (<namespace>--langwatch-golden)
make boxd-golden-reset BOXD_FORK_YES=1  # destroy + rebuild the golden
# Override the namespace explicitly (default = your gh login → whoami):
make boxd-golden BOXD_NAMESPACE=langwatch-team
make boxd-fork-pr PR=1234            # fork golden for an existing PR
make boxd-fork-branch BRANCH=feat/foo # fork golden for a branch
make boxd-fork-issue ISSUE=123       # fork + worktree branch + tmux+claude in VM
make boxd-connect-pr PR=1234         # SSH + tmux attach to the matching VM
make boxd-connect-branch BRANCH=feat/foo
make boxd-connect-issue ISSUE=123
# PR previews — ephemeral, forked from the team golden (langwatch-golden-v2):
make boxd-preview BRANCH=feat/foo           # fork team golden, start compose full, print URL
make boxd-preview-down BRANCH=feat/foo      # destroy the preview VM
make boxd-preview-status BRANCH=feat/foo    # VM status + git HEAD + docker compose ps
```

## Naming

| Source | VM name | tmux session |
|---|---|---|
| `fork-pr PR=N` | `langwatch-<slug(branch)>` | `claude-<slug(branch)>` |
| `fork-branch BRANCH=X` | `langwatch-<slug(X)>` | `claude-<slug(X)>` |
| `fork-issue ISSUE=N` | `langwatch-issue<N>` (literal) | `claude-issue<N>` |
| `preview BRANCH=X` | `preview-<slug(X)>` | (none — compose, not claude) |

Slug rules: lowercase, replace `/` and non-`[a-z0-9-]` with `-`, collapse `-`, trim, max 40 chars (truncate, no word-boundary cut).

Collision: `boxd-fork-branch BRANCH=issue42/foo` produces `langwatch-issue42-foo` — distinct from `boxd-fork-issue ISSUE=42`'s `langwatch-issue42`. The branch target prints a friendly nudge to use `fork-issue` if you didn't mean to.

## What each fork target does

1. Resolve the source-of-truth (PR head ref via `gh`, branch name as-is, issue title via `gh`).
2. Build VM name + tmux session name.
3. `boxd fork <namespace>--langwatch-golden --name=<vm>`.
4. Inside the VM: `git fetch origin && git checkout <branch>` (or detached head for cross-fork PRs).
5. Upload Claude credentials (default `~/.claude/.credentials.json`; override via `CLAUDE_CREDS=`).
6. Discover all `.env` files in the monorepo and upload each, with stale-localhost values rewritten to point at the VM's proxy URL.
7. Map ports: default proxy → `:5560`, plus subdomains for aigw (5563), bullboard (6380), ai-server (3456), next (3000).
8. **For `fork-issue` only:** start a tmux session inside the VM running `claude --dangerously-skip-permissions`.

## Connecting

`boxd-connect-*` SSHes via `boxd connect <vm>` and `tmux attach -t <session>`. If the VM is suspended (boxd auto-suspend), it's woken first. If the VM doesn't exist, you get a clear message and a non-zero exit. If the tmux session is missing, ditto.

## Customizing

| Env var | Default | Purpose |
|---|---|---|
| `CLAUDE_CREDS` | `~/.claude/.credentials.json` | Path to the file `boxd cp`-ed into the fork |
| `BOXD_FORK_YES` | unset | Set to `1` to skip the destructive-confirm on `boxd-golden-reset` |
| `BOXD_NAMESPACE` | `gh api user --jq .login` (fallback `whoami`) | Override the per-user prefix on the golden VM name (`<namespace>--langwatch-golden`). Useful for shared/team-owned goldens. |
| `LW_PREVIEW_GOLDEN_SOURCE` | `langwatch-golden-v2` | Team golden that preview VMs fork from. Override when using a personal or alternative base. |
| `BOXD_RESUME_TIMEOUT_SECS` | `30` | Max seconds to wait for a VM to reach `running` after `boxd resume` |
| `BOXD_BIN` | `boxd` | Override the `boxd` binary (used by tests) |
| `GH_BIN` | `gh` | Override the `gh` binary (used by tests) |

## Threat model — forks are trusted-developer environments

Forks receive every `.env` in the monorepo plus your Claude credentials. **Anyone with SSH access to a fork can read those secrets.** Forks are NOT for sharing across teams or external collaborators. If that ever changes, this design needs to revisit secret transport.

## Golden VM staleness

The golden VM is a single fixed-name VM per namespace (e.g. `drewdrewthis--langwatch-golden`), not a versioned image family. Boxd subdomains are globally unique across all accounts, so the namespace prefix prevents cross-team collisions. Reset = destroy + rebuild via `make boxd-golden-reset BOXD_FORK_YES=1`. The Makefile does **not** auto-rebuild.

Recommended cadence: rebuild **weekly**, or after any of:
- `pnpm-lock.yaml` change you want pre-installed
- Docker image bump (compose.dev.yml)
- Schema migration that changes seed data
- New top-level subproject added

## Seed step

`boxd-golden` calls a `seed-golden` hook target. The default `seed-golden` is a no-op that prints a hint. Override it locally (in a `Makefile.local` you `include` from `Makefile`) to seed users / projects / sample traces. Implementation of a shared seed script is out of scope for this Makefile — see `make quickstart` work.

## PR preview lifecycle

Preview targets complement `boxd-fork-*` with an **ephemeral, shareable** workflow:

1. **Fork** the team golden (`langwatch-golden-v2`) into `preview-<branch-slug>` — no per-user namespace prefix.
2. **Checkout** the branch inside the VM (`git fetch origin && git checkout <branch>`).
3. **Start** `docker compose -f compose.dev.yml --profile full up -d --build` — runs the full stack detached.
4. **Print** the URL: `https://preview-<branch-slug>.boxd.sh`.

Preview VMs do not receive `.env` uploads or Claude credentials — they are read-only stack snapshots for review/demo, not development environments.

```bash
# Spin up
make boxd-preview BRANCH=feat/my-feature
# => https://preview-feat-my-feature.boxd.sh

# Check what's running
make boxd-preview-status BRANCH=feat/my-feature

# Tear down when done
make boxd-preview-down BRANCH=feat/my-feature
```

The golden source is overridable:
```bash
LW_PREVIEW_GOLDEN_SOURCE=lw-preview make boxd-preview BRANCH=feat/my-feature
```

## Troubleshooting

**`boxd fork` fails with quota error.** You're at the 10-VM ceiling. `boxd list` to see what you have, `boxd destroy <vm>` to free a slot. Fork pruning is intentionally manual (see "Out of scope" below).

**`make boxd-fork-issue ISSUE=N` says the VM already exists.** Pick a different source, or destroy the existing VM:
```
boxd destroy langwatch-issueN
```

**`make boxd-connect-issue` says "no claude session".** The tmux session inside the VM was killed (or the VM was rebooted, which clears tmux state). Either re-run `make boxd-fork-issue` (idempotent on the worktree) or SSH in manually:
```
boxd connect langwatch-issueN
tmux new -s claude-issueN
```

**Stale localhost URL slipped through the rewrite.** Add the key to the allowlist in `scripts/boxd-fork.sh` (`boxd_rewrite_env`). The current allowlist: any `localhost:<port>` or `127.0.0.1:<port>` value, with `LW_GATEWAY_BASE_URL` routing to `aigw.<vm>.boxd.sh` and everything else routing to the default proxy.

**Git auth doesn't work inside the fork.** The host's git uses `credential.https://github.com.helper=boxd` — boxd ships a credential helper that the golden image inherits. If your laptop has a different setup, `git push` from inside the fork will prompt for credentials. Workaround: `boxd connect <vm>` and run `gh auth login`.

**"Claude credentials not found at …".** Set `CLAUDE_CREDS=/path/to/credentials.json` or run `claude login` inside the fork after fork-up.

## Out of scope

- **Seed script implementation** (belongs with `make quickstart` work — separate issue).
- **AWS-shared-postgres mode** for forks. If your team prefers shared DB, point your fork's `DATABASE_URL` there post-fork.
- **Convenience wrappers around single CLI calls** — use `boxd list`, `boxd destroy`, `boxd info`, `boxd ssh` directly.
- **Fork pruning / lifecycle management.** Closed-PR / merged-branch fork cleanup is a known follow-up (filed as a separate issue). Until then, run `boxd list` periodically and `boxd destroy` what you don't need.
- **Sharing forks across teams / external collaborators.** See threat model.
