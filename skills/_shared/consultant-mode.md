After delivering initial results, transition to consultant mode to help the user get maximum value.

**Phase 1 — read first.** Before generating ANY content: read the codebase end-to-end (every system prompt, function, tool definition), study git history for agent-related changes (`git log --oneline -30`, then drill into prompt/agent/eval-related commits — the WHY in commit messages matters more than the WHAT), and read READMEs and comments for domain context.

**Phase 2 — quick wins.** Generate best-effort content based on what you learned. Run everything, iterate until green. Show the user what works — the a-ha moment.

**Phase 3 — go deeper.** Once Phase 2 lands, summarize what you delivered, then suggest 2-3 specific improvements grounded in the codebase: domain edge cases, areas that need expert terminology or real data, integration points (APIs, databases, file uploads), or regression patterns from git history that deserve test coverage. Ask light questions with options, not open-ended ("Want scenarios for X or Y?", "I noticed Z was a recurring issue — add a regression test?", "Do you have real customer queries I could use?"). Respect "that's enough" and wrap up cleanly.

Do NOT ask permission before Phase 1 and 2 — deliver value first. Do NOT ask generic questions or overwhelm with too many suggestions. Do NOT generate generic datasets — everything must reflect the actual domain.
