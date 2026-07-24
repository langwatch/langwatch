# Skills dogfood tests

These are LangWatch Scenario tests that drive a real sub Claude Code session against each skill in `skills/<skill>/SKILL.mdx`, and assert that the agent picked up on the skill's instructions and produced the expected output (a test file, a CLI run, a piece of code). They prove the SKILL prompt is good enough that a fresh agent acts on it correctly.

## Run locally before every SKILL change — always

Every test file here is gated with `it.skipIf(isCI)` because each run:

- Spins up a real `claude` sub-process per scenario step.
- Talks to the live LLM (OpenAI, Anthropic) — both in the agent and in the judge.
- For voice tests, also reaches out to TTS providers.
- Costs real money per run and takes 5-15 min for the heavy ones (voice dogfood is ~10 min).

CI cannot gate on these. **You can.** If you change a `SKILL.mdx`, or anything in `skills/_tests/fixtures/`, or anything the SKILL references (LangWatch CLI flags, docs page slugs, adapter names), you MUST run the affected dogfood locally and read the generated artifact before opening a PR.

### Quick commands

```bash
# From repo root.
cd skills

# All skill tests (long, hits live LLMs, costs money). Don't.
pnpm vitest run _tests

# One specific skill test (the right grain — pick the one your change touches).
pnpm vitest run _tests/scenarios.scenario.test.ts

# One specific scenario inside a test file.
pnpm vitest run _tests/scenarios.scenario.test.ts -t "creates voice scenario tests"
```

### What "passing" actually means

Green dot is necessary, not sufficient.

1. Run the test.
2. Open the temp folder printed at the top of the run (`[voice dogfood] working dir: /tmp/langwatch-skill-scenarios-voice-py-XXX`).
3. **Read the generated file the agent produced** (e.g. `test_voice_agent.py`). The regex guardrails inside the test only check structural shape — they cannot tell you whether the agent picked the right adapter for the user's stack, used the right model, or wrote anything that would actually run.
4. If the generated file would not solve the user's stated problem, the SKILL is wrong. Fix the SKILL and re-run.

If you skip step 3, you're trusting the regex. The regex doesn't know about your domain. The regex is happy with `OpenAIRealtimeAgentAdapter(instructions="<placeholder>")` even when the user has a Pipecat bot. You have to read.

### Common failure modes

- `Error: Command failed with exit code 1` inside `callAgent` — the sub `claude` process crashed or rate-limited. Re-run; if it persists, check `~/.claude/projects/` for the agent's transcript.
- Test times out without a generated file — the SKILL didn't give Claude enough to act, or pointed it at a docs page that no longer exists. Read what Claude actually tried in its transcript.
- Test passes the regex but the generated file is nonsense — the regex is too loose. Tighten it AND fix the SKILL guidance that led to the nonsense.
