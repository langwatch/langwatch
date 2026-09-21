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

### Tests that connect a real agent to the platform

`scenarios.scenario.test.ts` ("run parameters of a connected agent") and `connect-agent.scenario.test.ts` ("connect_agent decorator") run against a live LangWatch project: the first starts the `fixtures/python-connected-agent` process with `uv run` and the Python SDK of this checkout, waits until `langwatch agent list` reads it Online, and archives it at the end. They skip themselves without the keys. They need:

- `uv` on PATH.
- `skills/.env` with `LANGWATCH_API_KEY` (a project key of a project you can fill with test runs) and `OPENAI_API_KEY` (the fixture agent and the judge use it).
- The local CLI built once: `pnpm --filter langwatch build`. The sub Claude runs `sdks/typescript/dist/cli/index.js`.

### Tests that need an organization login

`cli-projects-api-keys.scenario.test.ts` drives `langwatch projects` and
`langwatch api-keys`. Both reach the whole organization, so the CLI refuses a
project API key on them and reads the credential of `langwatch login`. The two
scenarios run on that login and skip when the machine has none, so run
`langwatch login` once before them. They also strip `LANGWATCH_API_KEY` from
the sub Claude, and the probe that decides the skip runs the CLI in a directory
of its own so `skills/.env` cannot answer for it.

### Disk

Most scenarios build their workspace with `fs.mkdtempSync` in the system temp
folder, and each one carries the `node_modules` or `.venv` the agent
installed. A run of the whole suite leaves tens of gigabytes there. A teardown
in `vitest.config.ts` removes them at the end of a run, skipping any directory
touched in the last ten minutes so parallel batches do not delete each other's
work. `KEEP_SKILL_TEST_WORKDIR=1` turns the sweep off along with the rest of
the cleanup, so a long session with that flag set needs the temp folder cleared
by hand.

`KEEP_SKILL_TEST_WORKDIR=1` keeps the working directory under `.claude/tmp/skill-tests/` after the run, so the scenarios, the suite and the run the agent created can be read back with `langwatch run-plan list` from inside it.

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
