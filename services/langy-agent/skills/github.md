# Skill: GitHub PRs

**Purpose**: Open real pull requests on the user's behalf — clone a repo, branch, commit changes, push, open a PR. The PR appears on GitHub authored by the requesting user.

**When to use**: User asks to "open a PR", "fix X in repo Y and submit it", "send a patch", "raise a pull request", or otherwise wants a code change landed on GitHub. Also when they ask you to apply a fix and you've already produced the diff — proactively offer the PR.

## Preflight: is GitHub connected?

The user's GitHub token rides into your env as `GH_TOKEN` (and their login as `GITHUB_LOGIN`). If `GH_TOKEN` is empty or unset:

> Reply with: "GitHub isn't connected for your account yet. Open the Connect GitHub card in the sidebar to authorize LangWatch as you — once connected I'll pick this up automatically." Then stop. Do NOT try to clone, do NOT prompt for a PAT, do NOT call `gh auth login`.

If `GH_TOKEN` is present, continue.

## One-time per session: configure git

Before the first clone of the session, run:

```bash
git config --global credential.helper '!gh auth git-credential'
git config --global user.name "$GITHUB_LOGIN"
# Use GitHub's noreply email so we never leak a private address.
# Numeric prefix is the GitHub user id — gh fetches it on demand.
GH_USER_ID=$(gh api user --jq .id)
git config --global user.email "${GH_USER_ID}+${GITHUB_LOGIN}@users.noreply.github.com"
```

Do this once. Do not re-run on subsequent PRs in the same session.

## Workflow: open a PR

1. **Pick a working directory inside `$HOME`** — never `/tmp`, never under `/workspace/skills`. Use `$HOME/work/<repo>` so the idle reaper cleans it with the session.
   ```bash
   mkdir -p "$HOME/work" && cd "$HOME/work"
   ```
2. **Shallow clone** the target repo (App installation must include it; otherwise this fails with 404 and you should tell the user the LangWatch App isn't installed on that repo):
   ```bash
   gh repo clone owner/name -- --depth 1
   cd name
   ```
3. **Branch** with a descriptive slug:
   ```bash
   git checkout -b langy/<short-slug>
   ```
4. **Make the edits** — read existing files, write changes, follow the repo's conventions.
5. **Commit**:
   ```bash
   git add -A
   git commit -m "<concise message describing the change>"
   ```
6. **Push and open the PR**:
   ```bash
   git push -u origin HEAD
   gh pr create --title "<title>" --body "<body>" --base main
   ```
   Use `--base` matching the repo's default branch (check via `gh repo view --json defaultBranchRef`).
7. **Report the PR URL** in your reply — the sidebar renders it as a PR card.

## Hard rules

- **Never run `gh auth login`.** The token is already in `GH_TOKEN`.
- **Never echo `$GH_TOKEN`** in logs, error messages, or chat replies. Never copy it into files.
- **Never write a `.git-credentials` file**, never `git config credential.helper store`. The helper above reads env only.
- **Stay inside `$HOME`**. Don't clone into `/workspace` or anywhere persisted across workers.
- **One PR per request.** Don't batch unrelated changes into a single branch.
- **Don't push to `main`** or any protected branch. Open a PR.

**Key CLI calls**: `gh repo clone`, `gh repo view`, `gh pr create`, `git checkout -b`, `git commit`, `git push`.
