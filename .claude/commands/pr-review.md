# PR Review

Review and address unresolved PR comments from Code Rabbit and reviewers.

## Steps

1. Get PR (from `$ARGUMENTS` or detect from current branch via `gh pr list --head`)
2. Fetch unresolved review threads via `gh api graphql`
3. Triage comments into categories:
   - **Fix now**: Security issues, bugs, logic errors, missing functionality in code we wrote
   - **Out of scope**: Changes to code we didn't touch, large refactoring beyond PR scope
   - **Won't fix**: False positives, style preferences that don't improve correctness
4. Implement fixes for all "fix now" items
5. Reply to threads explaining resolution or why not addressed
6. Resolve addressed threads via `gh api graphql` mutation
7. Check if rebase needed (`git rev-list --count HEAD..origin/main`)

## Responding to Comments

**Fix issues in code we wrote.** If a reviewer points out a problem in code this PR introduces or modifies, fix it now. "Future PR" is only for:
- Changes to unrelated code outside the PR's scope
- Large architectural changes that warrant separate discussion
- Pre-existing issues not introduced by this PR

Never defer fixing our own new code to a "future PR" - that's just avoiding the work.

When replying to comments:
- If fixed: briefly explain the fix
- If out of scope: explain why and what would be needed
- If won't fix: provide technical reasoning (not just "will do later")

## Output

Summary of: comments addressed, comments ignored (with reasons), files modified, rebase status.
