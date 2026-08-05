# Red teaming: SDK vs platform parity

What `@langwatch/scenario` accepts for a red-team attack, and what the platform
lets you set. Written against the vendored `langwatch-scenario-1.0.0.tgz` and
the [red-teaming docs](https://langwatch.ai/scenario/advanced/red-teaming),
with every row checked against `dist/index.js` rather than the docs alone —
three of the docs' claims turned out to be wrong (noted below).

The point of the platform surface is not to mirror all 18 options. It is that
someone who has never read the SDK docs can start a good run, and that anyone
who has read them does not hit a wall. So the split is: everything that changes
what the attack *does* is exposed; the knobs that only matter when you are
tuning cost or writing a custom strategy in code are not.

## Attack configuration

`RedTeamAgentConfig`, minus `strategy` (chosen by the factory).

| SDK option | Platform | Where |
|---|---|---|
| `target` | ✅ | "What should the attacker try to do?", with OWASP presets |
| `totalTurns` | ✅ | "Turns", defaults to 50 |

Three of these are bounded by the platform where the SDK leaves them open —
`target`, `attackPlan` and `metapromptTemplate` by length, `totalTurns` at 50.
All four values are re-read on every turn of a run that can be fifty turns
long, so an unbounded one is written once and paid for fifty times. The limits
sit well above anything a person writes; see `RED_TEAM_MAX_*` in
`execution/types.ts`.

| `model` | ✅ | reuses the scenario's simulator model — an attacker *is* a user simulator |
| `scoreResponses` | ✅ | "Adaptive scoring" |
| `detectRefusals` | ✅ | same toggle — the docs' fast recipe moves them together |
| `successScore` | ✅ | "Stop early at score" |
| `injectionProbability` | ✅ | "Obfuscation" |
| `attackPlan` | ✅ | "Attack plan" (Crescendo only) |
| `metapromptTemplate` | ✅ | "Planning prompt" (Crescendo only) |
| `successConfirmTurns` | ⚪ persisted, no input | in `redTeamConfig`; meaningless without `successScore`, which is exposed |
| `metapromptModel` | ❌ | a cost optimisation (plan with a strong model, attack with a cheap one). Needs a second model picker for a saving most people will not tune |
| `temperature` | ❌ | SDK default 0.7 is the researched value |
| `metapromptTemperature` | ❌ | as above |
| `maxTokens` | ❌ | capping attack messages makes attacks worse, not cheaper |
| `maxBacktracks` | ❌ | SDK default is 10; no reason found to vary it |
| `techniques` / `encodingTechniques` | ❌ | the Base64/ROT13 encoders behind `injectionProbability`. Editing the list means writing `AttackTechnique` classes |
| `goatTechniques` | ❌ | overriding GOAT's 7-technique catalogue means writing `Technique` objects. A list editor is real surface area for a "someone will ask" feature |

## Run wiring

| SDK concept | Platform |
|---|---|
| `marathonScript()` | ✅ always, for every red-team run |
| `script` on `run()` | ✅ the attacker's script, and nothing else |
| `maxTurns` on `run()` | ❌ deliberately — see below |
| `checks` / `finalChecks` | ❌ these are JS functions; there is no code to attach in a platform-authored scenario. The judge's criteria do this job |
| `JudgeAgent` criteria | ✅ the scenario's own criteria, unchanged |

## Three places the docs and the code disagree

Each was checked by reading `dist/index.js` and, where it changes behaviour,
pinned by a test.

**1. `maxTurns` — docs right, our implementation wrong.** The docs say
`total_turns` is the only duration control. That is correct: `run()`'s scripted
branch loops over `script.length` (`:10895`) and never reads `maxTurns`, which
only the auto-advance branch consults (`:11126`). We had been setting it, which
did nothing. Removed. `red-team-marathon-script.unit.test.ts` now executes a
run and counts turns; deleting `script:` makes it fail with "expected 6, got 1".

**2. `metapromptTemplate` — docs wrong.** The parameter table says
"TS: only via `redTeamAgent()`". It is not: `redTeamCrescendo` spreads its whole
config into the same constructor (`:9758`), so the field lands. That is why
"Planning prompt" can exist on the platform at all.

**3. `attackPlan` on GOAT — undocumented.** The docs warn that
`metapromptTemplate` is ignored for GOAT but say nothing about `attackPlan`.
Both are inert: `needsPlan ? await this.getAttackPlan(...) : ""` (`:9659`), and
`GoatStrategy.needsMetapromptPlan = false`. The SDK warns for one and is silent
for the other. The platform hides both fields when GOAT is selected, so nobody
fills in a plan that will not run.

## Objective presets

The `target` string drives planning, scoring and adaptation, and the docs are
explicit that vague objectives plan badly. A blank textarea is therefore the
easiest way to get a weak run, so `redTeamObjectives.ts` offers seven
concretely-phrased starting points keyed to the
[OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/):
LLM01, LLM02, LLM05, LLM06, LLM07, LLM08, LLM09.

Three are deliberately absent. LLM03 Supply Chain and LLM04 Data and Model
Poisoning are build- and training-time risks, and LLM10 Unbounded Consumption
is an infrastructure concern — a conversation with a deployed agent cannot test
any of them, and offering them would imply coverage that does not exist.
`redTeamObjectives.unit.test.ts` keeps that exclusion in place.
