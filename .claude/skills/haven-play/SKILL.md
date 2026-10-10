---
name: haven-play
description: "Try a GitHub PR on this machine with `haven pr` (own worktree, install, stack on a hostname) or `haven play` (a throwaway sandbox that destroys itself on quit), and browse worktrees with `haven git`. Use when someone says 'try a PR locally', 'haven pr', 'haven play', 'run this PR in a sandbox', 'review a PR by running it', 'play a PR', 'throwaway stack', 'haven git', or 'worktree overview'."
user-invocable: true
argument-hint: "pr <number> | play [pr] | git [target]"
---

# haven pr, play and git

| Command              | What it does                                           | Quitting           |
| -------------------- | ------------------------------------------------------ | ------------------ |
| `haven pr <ref>`     | worktree + install + stack up on a hostname            | keeps everything   |
| `haven play [pr]`    | own checkout, own databases, own hostname in a sandbox | DESTROYS all of it |
| `haven git [target]` | embedded git TUI for a worktree (slug, name or path)   | n/a                |

```bash
haven pr 4913 --dry-run                    # resolve and print the plan, create nothing
haven pr 4913                              # the real run
haven play 4913 --seed demo                # seeded sandbox; presets bare|demo|onboarding|post-onboarding
haven play 4913 --allow-untrusted          # the only way in agent mode when an author lacks write access
haven git --json                           # machine-readable per-worktree overview
```

`haven pr` flags: `--dry-run`, `--no-install`, `--allow-closed`, `--allow-scripts` (install lifecycle
scripts for a fork), `--discard-local-changes` (overwrite local edits instead of stashing).
Worktrees land in `HAVEN_WORKTREE_DIR`.

- `haven play` needs the GitHub CLI (`gh auth login`), discloses the destruction contract, passes a trust
  gate, starts a container tier, and tears down on quit (a hard kill leaves a record that `haven clean`
  finishes). An agent never runs it without being asked. Untrusted PR checkouts install without
  lifecycle scripts.
- Prefer a repo worktree via `make worktree <name>` for your own work; `pr` and `play` are for
  other people's code.
- `haven git` without `--json` is interactive: not for agents.
