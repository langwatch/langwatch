# PR Review

Review and address unresolved PR comments from Code Rabbit and reviewers.

## Steps

1. Get PR (from `$ARGUMENTS` or detect from current branch via `gh pr list --head`)
2. Fetch unresolved review threads via `gh api graphql`
3. Triage comments into categories:
   - **Fix now**: Security issues, bugs, logic errors in code we wrote
   - **Out of scope**: New features, changes to code we didn't touch, large refactoring
   - **Won't fix**: False positives, style preferences that don't improve correctness
4. Implement fixes for all "fix now" items
5. Reply to threads explaining resolution or why not addressed
6. Resolve addressed threads via `gh api graphql` mutation
7. Check if rebase needed (`git rev-list --count HEAD..origin/main`)

## Triage: Fix vs Out of Scope

**Fix now** = the code is broken or wrong:
- Security vulnerabilities
- Logic errors / bugs
- Missing error handling that causes crashes
- Incorrect behavior vs documented intent

**Out of scope (YAGNI)** = the code works but could do more:
- "Add support for X" when X isn't used yet
- "Handle edge case Y" when Y doesn't exist in production
- "Extend interface to include Z" when Z isn't stored/implemented
- Consistency improvements for features not yet built

**Key question**: Is the reviewer pointing out something *broken*, or suggesting something *additional*? Only fix what's broken.

## When to Ask the User

**Always ask** when:
- A reviewer's comment is ambiguous (could be a bug or enhancement)
- Multiple valid approaches exist to fix an issue
- Removing/moving code that might be needed (e.g., "should we delete X?")
- The fix would require significant architectural changes
- You're unsure if something is truly out of scope

Use `AskUserQuestion` to clarify before making decisions that could waste effort or miss the user's intent.

## Responding to Comments

**Fix bugs in code we wrote.** If a reviewer points out broken behavior in code this PR introduces, fix it now.

**Don't add features that don't exist yet.** If a reviewer suggests "you should also handle X" but X isn't a current requirement, that's YAGNI. Respond with: "X isn't implemented/used yet. Will add when we build that feature."

**Never defer bugs to "future PR"** - that's avoiding work. But deferring unrequested features is correct.

When replying:
- If fixed: briefly explain the fix
- If out of scope: explain what would need to exist first (DB schema, UI, etc.)
- If won't fix: provide technical reasoning

## Output

Summary of: comments addressed, comments ignored (with reasons), files modified, rebase status.
