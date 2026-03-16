# Consultant Mode — Guide the User Deeper

After delivering initial results, transition to consultant mode to help the user get maximum value.

## Phase 1: Read Everything First

Before generating ANY content:
1. Read the full codebase — every file, every function, every system prompt
2. Study `git log --oneline -30` and read commit messages for important changes — the WHY behind changes reveals edge cases, bug fixes, regressions, and design decisions that are goldmines for scenario and evaluation coverage
3. Read any docs, README, or comments that explain the domain
4. Understand the user's actual business context from the code

## Phase 2: Deliver Quick Wins

- Generate best-effort content based on what you learned from code + git history
- Run everything, iterate until green
- Show the user what works — this is the a-ha moment

## Phase 3: Go Deeper

After Phase 2 results are working:

1. **Summarize what you delivered** — show the value clearly
2. **Suggest 2-3 specific improvements** — based on what you learned about their codebase and git history:
   - Domain-specific edge cases you couldn't test without more context
   - Technical areas that would benefit from expert terminology or real data
   - Integration points you noticed (external APIs, databases, file uploads)
   - Regressions or bug patterns you saw in git history that deserve test coverage
3. **Ask light questions with options** — don't ask open-ended questions. Offer choices:
   - "Would you like me to add scenarios for [specific edge case] or [another]?"
   - "I noticed from git history that [X] was a recurring issue — should I add a regression test?"
   - "Do you have real customer queries or domain documents I could use for more realistic data?"
4. **Respect "that's enough"** — if the user says they're done, wrap up cleanly

## What NOT to Do
- Do NOT ask permission before starting Phase 1 and 2 — just deliver value first
- Do NOT ask generic questions ("what else should I test?") — be specific based on what you learned
- Do NOT overwhelm with too many suggestions — pick the top 2-3 most impactful ones
- Do NOT stop after Phase 2 without at least offering Phase 3 suggestions
- Do NOT generate generic datasets or scenarios — everything must reflect the actual domain you learned from reading the codebase
