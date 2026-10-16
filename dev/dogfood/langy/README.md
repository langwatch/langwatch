# Langy as a connected agent

Langy, the in-product assistant, connected to Agent Testing the way a customer
connects their own agent: `connectAgent` from the `langwatch` SDK, each turn
sent to Langy's public REST API, and scenario setup and teardown hooks
(ADR-180) that make and remove the test data. Every workaround it needs is a
feature gap, listed below.

## Files

```
src/agent.ts         connectAgent("langy"), the turn, the setup and teardown hooks
src/turn.ts          one Langy turn over POST /api/langy/conversations/:id/messages
src/world-names.ts   every world the `world` run parameter can name
src/worlds.ts        the board worlds (issue 8573: D1, D2, A1, D3, X1, D5, plus B1)
src/topic-world.ts   T1: Topic Clustering setup, model defaults snapshot and restore
src/quiet-world.ts   W1: only traces about 7 hours old, asked about the last 2 hours
src/login-world.ts   C1: a coding-agent cost question (issue 8770)
src/prompt-world.ts  the default world: a prompt with a marker phrase, and errored traces
src/http.ts          the public API with an API key and X-Project-Id
run.sh               starts the agent in the background against this worktree's haven stack
```

## What it does

- **Turn.** The newest user message goes to
  `POST /api/langy/conversations/<threadId>/messages` with
  `adoptConversationId: true` and `Prefer: wait=120`. The scenario's thread id
  is the Langy conversation id, so the agent keeps no session. An unsettled
  turn (HTTP 202) is awaited again with the same idempotency key, inside the
  300 s call cap.
- **Setup** builds the world named by the run parameter `world`:
  - `prompt_and_traces` (default): a prompt `e2e-<id>` whose text holds
    `PINEAPPLE-<ID>`, and 3 traces that fail with one unique error message.
  - `D1`, `D2`, `A1`, `D3`, `X1`, `D5`, `B1`: 48 traces with a per-run trace
    name over the last two full UTC days, a board with the row's widgets, and
    a decoy or second board where the row needs one.
  - `T1`: a snapshot of the project's model defaults (the Topic Clustering
    settings live there).
  - `W1`: 5 traces with a per-run name, the newest about 7 hours old.
  - `C1`: nothing; the question alone leads Langy to `langwatch whoami`.
- **After each turn** the world's code-check facts go in the state as
  `facts_now` and `facts_after_turn`, so the judge grades the world, not only
  Langy's words: per-board widgets added, changed or removed, what the newest
  widget counts and new alerts (board worlds); model-default keys changed (T1);
  the newest trace's age (W1); login or no-tools phrases in the reply (C1).
- **Teardown** returns the final facts, what it deleted or restored, and what
  it left behind (traces and saved charts have no delete route).

| Row                    | Labels           | Asks Langy to                            | Passes when                                                          |
| ---------------------- | ---------------- | ---------------------------------------- | -------------------------------------------------------------------- |
| D1, D2, A1, D3, X1, D5 | see issue 8573   | build, edit, delete or alert on a widget | the facts and the judge agree                                        |
| B1                     | jobs, regression | describe "dashboard `<id>`"              | it names the widgets; never "not available"                          |
| T1                     | jobs             | set up Topic Clustering                  | it does, or says it cannot and points to Settings → Topic Clustering |
| W1                     | jobs, confidence | find traces in the last 2 hours          | it says none, and how old the newest is                              |
| C1                     | safety, blame    | explain where the tokens went            | no sign-in or no-CLI advice to the user                              |

## Run it

Stack prerequisites (once per stack) are in `dev/dogfood/langy-hooks/README.md`
("Stack prerequisites"): `haven up -d +langy`, the two Langy flags on, and a
model provider for Langy, the simulator and the judge.

```bash
make dogfood-langy-hooks                         # or dev/dogfood/langy/run.sh
tail -f /tmp/langy-hooks-dogfood/langy-agent.log
kill "$(cat /tmp/langy-hooks-dogfood/langy-agent.pid)"   # stop
```

`run.sh` installs with `npm` on the first run (this package is not a member of
the pnpm workspace, like `acme-support`; it links the SDK of this checkout
through `file:`), finds the api port from `haven status`, and starts
`npm start` in the background.

In the app: Agent testing, open a scenario or the run plan "Langy dashboards
(hooks dogfood)", run it against `langy · development`. The run drawer shows
what setup and teardown returned.

| Variable                   | Meaning                                                                   |
| -------------------------- | ------------------------------------------------------------------------- |
| `LANGWATCH_ENDPOINT`       | The stack's base URL. `run.sh` sets it from haven                         |
| `LANGWATCH_API_KEY`        | A **personal** API key (gap 7). `run.sh` defaults to the seeded admin's   |
| `LANGWATCH_PROJECT_ID`     | The project the key acts in, default `local-dev-project`                  |
| `LANGY_DOGFOOD_FAIL_SETUP` | `1` makes setup throw, to show "Setup failed" and "Not scored"            |
| `LOG_DIR`                  | Where `run.sh` writes the log and pid, default `/tmp/langy-hooks-dogfood` |

## Test it

```bash
npm test     # the world parameter, the facts of each world, and the turn loop over a fake API
```

## Feature gaps

Each one is a workaround this agent makes that a customer's agent would also
hit. "Fix in" names who closes it.

1. **Langy's own spans never reach the judge.** The SDK hands the handler the
   turn's trace context (`sdks/typescript/src/agent/client.ts:201-208`), but
   Langy's REST turn takes none
   (`modules/langy/process/src/transport/langy-turns.rest.ts:79-90`), so Langy's
   tool calls land in a trace of their own. The judge marks every code check
   inconclusive without agent spans ("no agent spans arrived", all of
   `scenariobatch_0000AiO5CZRrHOwLAJ1iZRWh9VsYr`). Workaround: the connector
   traces the turn and the facts read itself (`setupObservability`, `src/agent.ts`);
   with that, D1 passed 4/4 on the facts. Fix in: **Langy API** (accept
   `traceparent` on a turn).
2. **Langy's ask-question tool cannot return over REST.** Only a settled turn
   carries a reply (`langy-turns.rest.ts:109-127`); a turn waiting on the user
   stays unsettled and answers 202 until the call times out (A1 asks "Which
   dashboard?" this way). Fix in: **Langy API** (return the pending question as
   the reply, take the answer as the next turn).
3. **REST turns carry no page context.** `turnContext: {}`
   (`langy-turns.rest.ts:88`), so "the board the user attached" has to be named
   in the user's message. Fix in: **Langy API** (accept a context on the turn).
4. **No on-demand insights run.** The public surface only configures a daily
   run (`modules/insight/process/src/transport/insight.trpc.ts:42-47`); running
   one now is an operator-console action
   (`modules/ops/process/src/services/scheduler-ops.service.ts:128`). Matrix rows
   I1, I2, I3, I5 are not built. Fix in: **Langy API** (insights).
5. **No API to create a second member.** The organization API only invites
   (`modules/organization/process/src/transport/organization-management.rest.ts:318`);
   a member exists once the invitee signs in. Row P1 (a member who cannot edit
   the board) is not built. Fix in: **agent testing** (a test identity a hook
   can make), or the organization API.
6. **No trace delete route.** The traces API reads and searches only
   (`modules/trace/process/src/transport/traces.rest.ts:311-434`), so teardown
   leaves the seeded traces behind and every run uses its own trace name to
   keep totals exact. Fix in: **agent testing** (a per-run project or a
   cleanup route).
7. **Langy refuses a project key.** A turn needs a personal key
   (`langy_api_key_unowned`, `modules/langy/contract/src/langy.errors.ts:400`),
   so a customer's CI cannot drive Langy with the project key it already has.
   Fix in: **Langy API**.
8. **No saved-chart delete route.** Charts are list-only
   (`modules/dashboard/process/src/transport/saved-workbench-chart.rest.ts:108`);
   teardown leaves a chart Langy made. Fix in: **Langy API** (dashboards).
9. **Code checks live in the state, not in the scenario.** A platform scenario
   has criteria for the judge only (`modules/scenario/contract/src/agent-test-scenario.ts:40`),
   while issue 8573 wants a code check first. Workaround: facts in the state, and
   criteria that name the keys. Fix in: **agent testing** (checks a hook returns
   decide the verdict before the judge).
10. **One project is shared by every run.** Counts are scoped by a per-run tag
    and trace name, and "items this run made" replaces project-wide counts
    (`src/worlds.ts` `buildFacts`). Fix in: **agent testing** (a per-run project).
11. **A 300 s call cap against minute-long widget builds.** The SDK caps a call
    at 300 s (`sdks/typescript/src/agent/define.ts:30`) and one REST wait at
    120 s, so a turn re-POSTs with the same idempotency key (`src/turn.ts`).
    Fix in: **Langy API** (a stream or poll route for a turn).
12. **The conversation id must fit Langy's shape.** Adopting the thread id works
    only for `[A-Za-z0-9_-]{6,120}`
    (`modules/langy/process/src/rules/langy-conversation-shape.rules.ts:30`);
    the platform's `scenario_…` ids fit today. Fix in: **Langy API** (document
    it on the route).
13. **B1: Langy cannot see a board's widgets** (a Langy bug). Langy reads a
    board through the Reports API `GET /api/v1/dashboards/:id`; #8707 (on main,
    not on this branch) hides Dashboards-only boards from it
    (`prisma.dashboard.repository.ts:147`). Even here Langy answered "Release
    review 816422 is empty right now, with no graphs configured" for a board
    with two widgets (`scenariorun_8390b10b758f5c77d3df3910487d715b`), and in X1
    said "There isn't an Error count widget" (`scenariorun_d3ea8eb7a7d41c491b219035d7b509fe`):
    it sees classic graphs, not dashboard widgets. Fix in: **Langy**.
14. **T1: Langy has no Topic Clustering tool** (missing Langy tool). Setup is
    Settings → Topic Clustering, models under Settings → Model Providers →
    Default Models; a run starts only through the tRPC `topics.triggerTopicClustering`
    (`modules/topic/process/src/transport/topic.trpc.ts:58-60`), and no public
    route reads a run, so the facts see model defaults only. Fix in: **Langy**
    (a tool), and the topic API (a REST trigger and status).
15. **C1: a coding-agent cost question may reach `langwatch whoami`**, which
    only reads the device-login file (`sdks/typescript/src/cli/commands/whoami.ts:84-91`)
    and in Langy's sandbox says "Not logged in. Run `langwatch login --device`";
    the coding-agent skills tell Langy to run it
    (`services/langyagent/internal/assets/skills/coding-agent-cost/SKILL.md:17,43`).
    Issue https://github.com/langwatch/langwatch/issues/8770. **The cause
    reproduces, the symptom did not:** in both C1 runs Langy ran
    `langwatch whoami -o json` and got `not_authenticated` "Not logged in. Run
    `langwatch login --device`…", but its replies gave no login or no-CLI advice
    (`scenariorun_fc2a073180b6d2d8bf1b90ac9cde902b`,
    `scenariorun_28e61c8a4d78668e06a922bb05d34532`; tool calls read from the
    app's `langy.messages`, which the connector cannot call, gap 16). Fix in:
    **Langy** (skills and the CLI in the sandbox).
16. **Langy's tool results have no public read.** No REST route returns a
    conversation's messages or tool calls (`modules/langy/process/src/transport/`),
    so C1 can only check what Langy's replies say, not whether a tool returned
    "Not logged in". Fix in: **Langy API**.
17. **No concurrency setting for a plan run, against a 2-worker Langy.** The run
    dialog has no concurrency field; the slot budget is a worker setting
    (`modules/scenario/contract/src/scenario.config.ts:75-80`), and capping the
    agent's own `concurrency` fails runs after a 60 s busy budget
    (`apps/scenario-child/src/channels/http/http.serialized-connected-agent.channel.ts:18`).
    Langy runs at most 2 workers (`LANGY_MAX_WORKERS=2`), so a plan run gets 503
    `langy_worker_stopped` on the overflow (W1 in
    `scenariobatch_0000Hv9ALvjHhPStJlJzod741JEEj`). Fix in: **agent testing**
    (a per-plan concurrency) and **Langy** (queue a turn instead of failing it).
18. **Cancel does not stop the Langy turn or run teardown.** A cancelled run
    leaves its Langy turn holding a worker for up to 5 minutes, and the data
    setup made stays. Fix in: **agent testing** (cancel the call, then run
    teardown) and **Langy API** (a cancel route for a turn).
19. **"Run again" on a plan's row makes a new one-scenario plan** instead of
    rerunning that row inside the plan. Fix in: **agent testing**.
