# PR Review

Review and address unresolved PR comments from Code Rabbit and reviewers.

## Steps

1. Get PR (from `$ARGUMENTS` or detect from current branch via `gh pr list --head`)
2. Fetch unresolved review threads via `gh api graphql`
3. Triage: address (security, bugs, logic errors) vs ignore (style nitpicks, false positives)
4. Implement fixes for comments to address
5. Resolve addressed threads via `gh api graphql` mutation
6. Check if rebase needed (`git rev-list --count HEAD..origin/main`)

## Output

Summary of: comments addressed, comments ignored (with reasons), files modified, rebase status.
