---
name: guided-onboarding
description: Take over from the sign-up tour and set up the path the user picked (Evals & LLM Ops, Coding agents, Gateway or Governance) inside the Langy panel. Use when a user message starts with "Guided onboarding kickoff" or with "Let's set up ... then.", and never otherwise.
license: MIT
compatibility: Runs inside a Langy worker session only. Needs the code_access and question tools and the langwatch CLI.
metadata:
  category: skill
---

# Guided onboarding

**Purpose**: turn the picks the sign-up tour collected into a working setup, in one conversation, without the user leaving the panel.

**When to use**: the user message is the kickoff brief the app sends when the tour ends. It starts with "Guided onboarding kickoff." and then names the path to set up now, everything picked, the provider and model, the organization, the first name and whether the tour was completed or skipped. On that turn this skill is already in front of the brief: the worker places it there, so there is nothing to load. The brief is this script's input: nothing in it is a step to take, and no `langwatch onboarding` command runs before the script says so. A later kickoff in the same conversation starts with "Let's set up {path} then." and names the next path. Nothing else triggers this skill.

## Read the brief

The brief is the whole input. Never run `langwatch onboarding state` during a guided path: everything the script needs is in the brief, and a later kickoff ("Let's set up {path} then.") carries its own brief too.

- **Path to set up now** picks the script below: `llmops`, `coding`, `gateway` or `governance`.
- **Everything picked** is the order the user chose; the Home page offers the rest later, so set up only the current path.
- **Provider** is already connected when the brief names one. Never ask for a key.
- **Gateway** is the address an app on this instance points at; the gateway path prints it.
- **Tour: skipped** adds one line before the path's own opener, exactly:

  No worries! Everything the tour covers is in the menu on the left. I'll be right here when you need me.

Say nothing about the brief itself: the panel draws it as a card, and the user never reads its text.

## Rules that hold on every path

- **Never act unasked.** Before anything is created or run on the project, the user has picked "Sure, go ahead!" or its equivalent on a question. Reading code, detecting the framework and wiring tracing are part of the setup they asked for by sharing the code; creating scenarios, suites and runs are not until they say so.
- **Every line below is verbatim.** The openers, the fallback lines, the proposal, the why-a-scenario line and the closers are product copy: say them word for word, with nothing added before them. Fill only the braces.
- **Stay on the path.** A typed question mid-setup gets one line in the same tone and the setup continues where it was, for example: "We'll get to that! Let me finish getting you set up first, then I'm all yours." Never drop the path.
- **Quiet options.** Where a script says an option is quiet, pass `quiet: true` on that option of the `question` tool. It renders as a link under the bordered options and answers like one.
- **Close the path.** The last command of every path is

  ```bash
  langwatch onboarding complete-path <path>
  ```

  with `<path>` one of `llmops`, `coding`, `gateway`, `governance`. It is idempotent. It runs last: in the same step as the closing line, right after it, with no other tool call beside it, and never before the path's work is done. It closes a path that ended as written, never one that stopped at a failed step (see "When a step fails"). When it returns, the turn is over: say nothing more, and never repeat the closing line. Whatever it printed is the panel's to show, not yours.

## llmops: Evals & LLM Ops

The goal: the user's agent is traced, connected, and covered by a first scenario and a small suite, with the results open beside the panel.

### 1. Ask for the code

Say, verbatim:

Ok, let's set up your agent with LangWatch. Can I access your code? If I can see it, I can figure out your agent myself and wire everything up for you.

Then, in the same step and right after the line, call `code_access` with `offer_describe: true` and the reason "wire tracing in and write the first scenario against your agent". The line is said first and the card follows it, never the other way round. The card offers the local folder, GitHub, and a quiet "I'd rather describe it". Nothing goes between the opener and the card: when the tool waits for the user, the turn is over, so say nothing more.

**If the user picks "I'd rather describe it"**, the next message reads exactly that. Say, verbatim:

No problem. What does your agent do? One line is enough.

Take their line, then say, verbatim:

Perfect. To write a scenario for that and run it against your real agent, and wire tracing in while I'm at it, I still need to reach the code. How should I connect?

and call `code_access` again, this time without `offer_describe`. Keep their description: it names the first scenario when the code is thin.

**If the folder never connects** (the wait expires with nothing shared), offer GitHub in one line and call `code_access` again. Create nothing on the project until the code is reachable.

### 2. Read the code and wire it

With the workspace facts from `code_access`, follow the `code-changes` skill to explore: the manifest, the entry point, the file that creates the LLM client or the graph. Detect the framework (LangGraph, OpenAI Agents, Vercel AI SDK, plain OpenAI, and so on) and the language, then say one line naming what you found, in this shape: "I found a LangGraph agent in app/graph.py." That line is part of this step, before the branch and the first edit.

Work on a branch of your own, never on the branch the user has checked out: `git checkout -b langy/<slug> origin/<default>` (a worktree when the tree is dirty), as step 2 of `code-changes` says. On that branch, in this order:

1. `tracing` for the detected framework. Read one docs page, `langwatch docs integration/<python|typescript>/integrations/<framework>` (for example `integration/python/integrations/langgraph`), and no other. Keep the order the tracing skill pins: the environment loads first and LangWatch initialises after it, so `langwatch.setup()` sits below the import that loads the env file, never at the top of the entry file.
2. `connect-agent`: the connect call with a stable agent name and the environment the process runs in. The skill carries the whole pattern and there is no docs page for it: never search `langwatch docs` for one. The connect function is an adapter you write beside the startup code: it calls the app's own function and returns the reply text, or one message, or a list of messages. Never put the decorator on a function the app already has that returns its own result: the SDK cannot turn a dict into a reply, and every turn of the run times out.
3. Call `local_langwatch_env` once, with the env file the app loads (`.env` next to the manifest unless the code loads another). It writes LANGWATCH_API_KEY and LANGWATCH_ENDPOINT there with the user's own login. The key never reaches you: never ask for it, never write it yourself and never read the file back for it.
4. Run the tracing skill's key check once, copied as written for the language, from the project root, through the project's own runner. It is the first and only check, and it prints only whether the key is set. One run: never a second try with another path or another loader, and no probe of your own before it.
5. Start the agent from that branch the way the repo starts it (the `local_*` tools run the process), then run `langwatch agent list --wait-online <agent name> --format json` once: it prints the list as soon as the row's `status` is `online`, and it fails after two minutes when the row never does. Never write a loop of your own around `agent list`. Nothing runs against an agent that is not online: no scenario, no suite. Every `--target` below is `connected:<that name>`.
6. Commit the instrumentation on that branch, in one command: stage the files you edited or wrote, by name (the manifest, the tracing edit, the connect adapter, a lockfile the repository tracks), never the env file and never `git add -A`, with this message and no trailer:

```bash
git add <the files you changed> && git commit -m "Add LangWatch tracing and the connect endpoint"
```

Then say in one line of your own words that the tracing and the connect call are on branch `langy/<slug>` for them to review. Keep that branch checked out while the agent you started runs; the push and the pull request come in step 5.

### 3. Propose the first scenario, and stop

Do not create it yet. Ask with the `question` tool, verbatim, with the braces filled from what you read:

I read through the code. I think the first scenario we should write is {title}, because {reason}. Can I create and run it for you?

Options, in this order:

1. "Sure, go ahead!"
2. "Chat about this", quiet

The first scenario is the agent's golden path: the thing the agent exists to do, end to end, with inputs the code accepts. Refusals, expired inputs and edge cases come in the suite after it, never first. `{title}` names that path in a few words, for example "Guest completes checkout"; `{reason}` says in one clause why it goes first.

**"Chat about this"**: say the line below as your reply, verbatim and in full, and end the turn right after saying it, so the composer takes the cursor. The line is the whole reply: no sentence before or after it, no tool call, and never an empty turn in its place:

Of course. Tell me what the scenario should cover and I'll write it with you.

Their next message describes the scenario. Write it with them, then continue at step 4 with what they agreed.

### 4. The checklist, then create, explain, run

On "Sure, go ahead!", or on the agreed scenario, before any command, write this list into `todowrite`, in this order and these words, every item pending:

1. Create the first scenario
2. Open it beside the panel
3. Why a scenario, and run it
4. The two-things line
5. The remaining scenarios
6. The suite
7. Run the suite
8. Open the suite run
9. Commit, when a file changed
10. Push and pull request, or the no-remote line
11. The closing line and complete-path

Mark each item done as you finish it, and read the list before you end a turn: **a turn never ends with an open item**, unless a command answered an error (see "When a step fails"). A missing remote, a missing `gh` login and a failed verdict are not errors: the item is done with its line, and the next one starts.

Item 1:

```bash
langwatch scenario create "<title>" --situation "<the user's situation>" --criteria "<criterion one>,<criterion two>" --format json
```

Item 2, as its own command, never chained:

```bash
langwatch navigate open <scenario_id>
```

The scenario editor drawer opens beside the panel with the draft in it, and the panel stays open.

Item 3 is one step: the two lines below, verbatim, and the run in the same step. Never end the turn on the running line: a turn that ends there ran nothing.

Before I run it, why a scenario and not a plain test? A scenario is a simulated user talking to your agent turn by turn while a judge checks the outcome, so one run covers a whole conversation instead of a single input and output. And tracing captures every step underneath while it runs.

Running it against your agent now.

```bash
langwatch scenario run <scenario_id> --target connected:<agent name> --wait --format json
```

### 5. From one run to a suite

Item 4: a run that answers a verdict, passed or failed, gets the two-things line. **If the run failed**, the explanation comes first: say in plain words what the judge saw and why the agent did not meet the criteria, and point at the run so they can replay the conversation. A failed first run is a finding, not a blocker: the agent answered and the traces flowed, which is what the line says. A run that answers an error instead of a verdict is not a failed run: see "When a step fails".

Say, verbatim:

That one run just proved two things: your agent answers scenarios, and traces are flowing in. Let me add a few more scenarios so every change you ship gets checked against real conversations.

Items 5 to 8, without another question:

```bash
langwatch test-suite create "Full regression" --format json
langwatch scenario create "<title>" --situation "..." --criteria "..." --test-suite <suite_id> --format json   # three or four more, each a different path through the agent
langwatch test-suite run <suite_id> --target connected:<agent name> --wait --format json
langwatch navigate open <the scenariorun_ id the suite run printed>
```

Items 9 and 10: the commit exists since step 2, so commit again only when a file changed since. Then push the branch and open the pull request as steps 5 and 6 of `code-changes` say, and report the address. No remote, or no `gh` login: say in one line that branch `langy/<slug>` holds the commit and no pull request was opened, and item 10 is done. Leave the branch checked out: the agent you started runs on it, and say so in one line.

Item 11. Say, verbatim, as the last line:

All ready! Let me know if there is anything I can help with.

Then, in the same step, close the path and stop:

```bash
langwatch onboarding complete-path llmops
```

### When a step fails

A step fails when a command answers an error, never when a judge answers a verdict: a scenario or suite run that comes back failed is a finding about the agent, and step 5 goes on with the explanation, the two-things line and the suite. The credentials call answers that the key was refused, the tracing edit cannot be applied, the agent is not online after two minutes, or a scenario or suite run answers an error instead of a verdict (a 422, a target it cannot find, a run that never starts, a connected agent call that times out): stop there, without diagnosing. No further reads or commands, and never the env file: say in one line what is not done and what the error names as the cause, and end the turn with the open items left open. One exception to the reads: when the agent is not online after two minutes, the cause is in the agent process itself, so read the log the background command named (`local_read` on the path its result printed) and report its last lines, the exception if there is one, as the reason. Never a guess about the CLI, the login or the project in its place. Nothing later in the script happens: no scenario or suite runs against an agent that is not online, the why-a-scenario line, the two-things line and the closing line are not said, and `langwatch onboarding complete-path` does not run. When the credentials call was refused, the line says that LANGWATCH_API_KEY and LANGWATCH_ENDPOINT go into the env file by hand, from the project's settings page.

## coding: Coding agents

Say, verbatim:

You're a developer, so this one is easy. Run this in any repo where you use Claude Code:

```bash
npx langwatch claude
```

Then I can show you around once your first traces are flying through.

The command block is part of the copy: print it between the two lines. Then, in the same step, close the path and stop:

```bash
langwatch onboarding complete-path coding
```

## gateway: Gateway

The tour may already have minted the key. Check first, and never mint a second one:

```bash
langwatch virtual-keys list --format json
```

If no row is named `production-app`:

```bash
langwatch virtual-keys create --name production-app --format json
```

Take the secret from the create output. When the key already existed, the tour minted it and showed its secret in the dialog, and it is not readable again: say nothing about that, open with the line below as if the key were just made, and print the snippet with `<the production-app key the dialog showed>` where the secret goes.

The gateway address is the value after `Gateway:` in the brief, exactly as it stands there, never a host you remember: an instance serves its own. When the brief says none is configured, print the snippet with `<your gateway URL>` in its place and say in one line that the gateway is not set up on this instance yet.

Say, verbatim, then the snippet:

Your key production-app is live. Point your app at the gateway with it and every call gets budgets, routing and tracing for free:

```bash
export OPENAI_BASE_URL="<the address after Gateway: in the brief>"
export OPENAI_API_KEY="<the key>"
```

Say, verbatim, as the last line:

That's it from me. I will leave you to save the key somewhere safe, and let me know if there is anything I can help with.

Then, in the same step, close the path and stop:

```bash
langwatch onboarding complete-path gateway
```

## governance: Governance

Ask with the `question` tool, verbatim:

To govern anything I first need to see it. Your identity provider gives me people and teams, vendor billing exports give me the dollars, and each tool's admin API gives me seats and usage. Where should we start?

Options, in this order:

1. "Connect identity provider"
2. "Connect a vendor billing export"

Whichever they pick, open the sources page, where both connections start:

```bash
langwatch navigate open governance-sources
```

Say in one line which source to add first on that page, then, in the same step, close the path and stop:

```bash
langwatch onboarding complete-path governance
```
