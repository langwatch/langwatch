---
name: guided-onboarding
description: Take over from the sign-up tour and set up the path the user picked (Evals & LLM Ops, Coding agents, Gateway or Governance) inside the Langy panel. Use when a user message starts with "Guided onboarding kickoff" or with "Let's set up ... then.", and never otherwise.
license: MIT
compatibility: Runs inside a Langy worker session only. Needs the code_access, question, say and secret_snippet tools and the langwatch CLI.
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
- **Virtual key** names the key the tour minted, with its preview (the first characters) and its reveal id, or says none was minted. When it names a reveal id, the line itself says what to do, and that is the whole gateway path: show the key with `secret_snippet` using this reveal id, and do not list, ask or create keys. The secret is never in the brief: the reveal id is what shows it, once, through the `secret_snippet` card.
- **Tour: skipped** adds one line, said with `say`, before the path's own opener, exactly:

  No worries! Everything the tour covers is in the menu on the left. I'll be right here when you need me.

Say nothing about the brief itself: the panel draws it as a card, and the user never reads its text.

## Rules that hold on every path

- **Never act unasked.** Before anything is created or run on the project, the user has picked the create option on the proposal or its equivalent on a question. Reading code, detecting the framework and wiring tracing are part of the setup they asked for by sharing the code; creating scenarios, suites and runs are not until they say so.
- **Every line below is verbatim, and said with the `say` tool.** The openers, the fallback lines, the step 2 lines, the why-a-scenario line, the running line, the two-things line and the closers are product copy: say each with the `say` tool, word for word, at its moment in the script, with nothing added before it. Fill only the braces. The tool draws the text in place, where the call happens, so the person reads it before the next call runs; the reply text at the end of the turn is not where these lines go, and a turn whose lines were all said this way ends with no reply text at all. Never say a line twice, and never repeat in the reply text a line already said. The proposal is the one exception: it is the `question` field of its bare question.
- **Stay on the path.** A typed question mid-setup gets one line, said with `say`, in the same tone, and the setup continues where it was, for example: "We'll get to that! Let me finish getting you set up first, then I'm all yours." Never drop the path.
- **Quiet options.** Where a script says an option is quiet, pass `quiet: true` on that option of the `question` tool. It renders as a link under the bordered options and answers like one.
- **Close the path.** The last command of every path is

  ```bash
  langwatch onboarding complete-path <path>
  ```

  with `<path>` one of `llmops`, `coding`, `gateway`, `governance`. It is idempotent. It runs right before the closing line, in the same step, with no other tool call beside it, and never before the path's work is done. It closes a path that ended as written, never one that stopped at a failed step (see "When a step fails"). When it returns, say the closing line with `say`, verbatim, as the last thing the turn does, and the turn is over: no reply text after it, and never the line twice. Whatever the command printed is the panel's to show, not yours.

## llmops: Evals & LLM Ops

The goal: the user's agent is traced, connected, and covered by a first scenario and a small suite, with the results open beside the panel.

### 1. Ask for the code

Say with `say`, verbatim:

Ok, let's set up your agent with LangWatch. Can I access your code? If I can see it, I can figure out your agent myself and wire everything up for you.

Then, in the same step and right after the line, call `code_access` with `offer_describe: true` and the reason "wire tracing in and write the first scenario against your agent". The line is said first and the card follows it, never the other way round. The card offers the local folder, GitHub, and a quiet "I'd rather describe it". Nothing goes between the opener and the card: when the tool waits for the user, the turn is over, so say nothing more.

**If the user picks "I'd rather describe it"**, the next message reads exactly that. Say with `say`, verbatim:

No problem. What does your agent do? One line is enough.

Take their line, then say with `say`, verbatim:

Perfect. To write a scenario for that and run it against your real agent, and wire tracing in while I'm at it, I still need to reach the code. How should I connect?

and call `code_access` again, this time without `offer_describe`. Keep their description: it names the first scenario when the code is thin.

**If the folder never connects** (the wait expires with nothing shared), offer GitHub in one line and call `code_access` again. Create nothing on the project until the code is reachable.

**While a folder is connected, `code_access` is never called again.** The card is for the not-connected case only: the connect brought the folder facts, and the files are read with the `local_*` tools. A folder that looks empty is read with `local_ls`, never with the sandbox's own shell, which holds no project of the user's.

### 2. Read the code and wire it

With the workspace facts from `code_access`, follow the `code-changes` skill to explore: the manifest, the entry point, the file that creates the LLM client or the graph. Detect the framework (LangGraph, OpenAI Agents, Vercel AI SDK, plain OpenAI, and so on) and the language, then keep one line naming what you found, in this shape: "I found a LangGraph agent in app/graph.py." That is the framework line: it is said with `say` right before the question of step 3, with the two lines of item 8. The file it names is one you read with `local_read` in this step, and the framework is what that file imports: a docs page is never a source for the line, and a framework no file of theirs shows was not found.

Before the branch and the first edit, write this list into `todowrite`, in this order and these words, every item pending:

1. Read the code and name the framework
2. The langy branch checked out
3. The langwatch package added through the project's own package manager
4. The tracing edit
5. The connect adapter
6. Credentials written and checked
7. The agent started in the background
8. The agent online, through agent list --wait-online
9. The commit
10. The push and the pull request, or the no-remote line
11. The three step 2 lines said

Mark each item done as you finish it, and read the list before you end a turn: **a turn never ends with an open item**, unless a command answered an error (see "When a step fails"). The bare question of step 3 is asked only when every item of this list is done, never with one open: an item skipped is a step skipped, whatever the lines say.

Work on a branch of your own, never on the branch the user has checked out: `git checkout -b langy/<slug> origin/<default>` (a worktree when the tree is dirty), as step 2 of `code-changes` says. On that branch, load the `tracing` and `connect-agent` skills with the `skill` tool, then, in this order:

1. Install the package, as step 2 of the `tracing` skill says for the language, from the project root, through the project's own package manager: `uv add langwatch` when the project has a `uv.lock`, `pip install langwatch` otherwise; `npm install langwatch` or `pnpm add langwatch` by the lockfile present. The item is done when the manifest (`pyproject.toml` or `package.json`) names the package. An import of a package that was never installed kills the agent at start, and the wait of item 6 runs its full two minutes for nothing.
2. `tracing` for the detected framework. Read one docs page, `langwatch docs integration/<python|typescript>/integrations/<framework>` (for example `integration/python/integrations/langgraph`), and no other. Keep the order the tracing skill pins: the environment loads first and LangWatch initialises after it, so `langwatch.setup()` sits below the import that loads the env file, never at the top of the entry file.
3. `connect-agent`: the connect call with a stable agent name and the environment the process runs in. The skill carries the whole pattern and there is no docs page for it: never search `langwatch docs` for one. The connect function is an adapter you write beside the startup code: it calls the app's own function and returns the reply text, or one message, or a list of messages. Never put the decorator on a function the app already has that returns its own result: the SDK cannot turn a dict into a reply, and every turn of the run times out. On this path the SDK is always installed, item 3 of the checklist, so the adapter is the SDK connect call: the `@langwatch.connect_agent` decorator in Python, `connectAgent` in TypeScript. The HTTP fallback at the bottom of `connect-agent` is never used here: a route on a path, `@app.post("/langwatch/connect")` or the like, registers nothing with the SDK, the process starts cleanly and the agent never comes online. A route is not an adapter.
4. Call `local_langwatch_env` once, with the env file the app loads (`.env` next to the manifest unless the code loads another). It writes LANGWATCH_API_KEY and LANGWATCH_ENDPOINT there with the user's own login. The key never reaches you: never ask for it, never write it yourself and never read the file back for it. An env file is never printed, with `cat` or any other command: the terminal that runs it is shared, and a key printed there is a key shown. When the names it holds matter, to know which provider the app uses, read them alone with a command that prints keys and no values, such as `sed 's/=.*//' .env`.
5. Run the tracing skill's key check once, copied as written for the language, from the project root, through the project's own runner. It is the first and only check, and it prints only whether the key is set. One run: never a second try with another path or another loader, and no probe of your own before it. For Python that is this command, with `-c` and never `python -` with a heredoc (the loader fails on standard input):

   ```bash
   uv run python -c "from dotenv import load_dotenv; load_dotenv(); import os; print(bool(os.getenv('LANGWATCH_API_KEY')))"
   ```

   `False` is not a failed step: fix the load order of item 2 and run the same command again.
6. Start the agent from that branch the way the repo starts it (the `local_*` tools run the process), then run `langwatch agent list --wait-online <agent name> --format json` once, with the `timeout` parameter of the shell tool set to 150: it prints the list as soon as the row's `status` is `online`, and it fails after two minutes when the row never does. The wait takes up to 120 seconds, so a shell limit at or under that cuts the command before the CLI prints its line, and what you read is the shell's limit instead of the line naming the agent, the wait and the credentials: the wait always gets more room than it takes. Never write a loop of your own around `agent list`. Nothing runs against an agent that is not online: no scenario, no suite. Every `--target` below is `connected:<that name>`.
7. Commit the instrumentation on that branch, in one command: stage the files you edited or wrote, by name (the manifest and the lockfile the install of item 1 changed, the tracing edit, the connect adapter), never the env file and never `git add -A`, with this message and no trailer:

```bash
git add <the files you changed> && git commit -m "Add LangWatch tracing and the connect endpoint"
```

8. Push the branch and open the pull request, as steps 5 and 6 of `code-changes` say, with the title `Add LangWatch tracing and the connect endpoint`. The body goes in a file: write `.langwatch/pr-body.md` with `local_write` first, and only then the command that reads it with `--body-file`; a command that names a file that was never written fails on the file, not on the remote. Then run `git branch --show-current`: its output is the name the lines below carry. The pull request line is this, verbatim, with the brace filled with the address `gh pr create` printed, and said only when it printed one:

I opened a pull request with the tracing change: {link}. You can merge it already.

No remote, or no `gh` login: no pull request was opened, so this line takes the pull request line's place, verbatim, with the brace filled with the branch name, and the step is done:

No pull request was opened, since the folder has no remote or gh is not signed in: branch {branch} holds the commit.

That line is said only when the push or `gh` answered that there is no remote or that `gh` is not signed in: a reason the output did not name is never said. Any other `gh` error, a missing body file, a wrong base, gets one fix of its cause and one retry of the command; when it still fails, this line, verbatim, takes the place of both, with the second brace filled with the one line the command printed, and the step is done:

The branch {branch} is pushed; opening the pull request failed with: {error}.

Either way, keep that branch checked out: the agent you started runs on it, and the branch line says so, verbatim, with the same brace:

I left branch {branch} checked out: the agent you started runs on it.

These three lines of step 2, the framework line, the pull request line, the no-remote line or the failed-open line, and the branch line, are said with the `say` tool, one call each, in that order, in this same step, right after the pull request command answered and right before the question of step 3: never after the answer, and never in the reply text. They are said only about things that happened, from what the commands printed: never fill a brace with a fallback sentence, and never name a branch, a commit or a pull request that a command did not make; a line about a thing that did not happen is a false claim about the user's repository. The proposal of step 3 comes right after them, in the same turn.

### 3. Propose the first scenario, and stop

This question is the gate of step 4: no `scenario create`, no run and no suite before the person has answered it. Whatever arrives first, a message describing a scenario, a question, or a setup that stopped at a failed step and was then fixed, finish step 2 and ask it; a scenario the person described before the question becomes `{title}` in it, and the answer is still theirs to give.

Do not create it yet. With the three step 2 lines said, ask with the `question` tool with `bare: true`, in that same turn, with no reply text before the call: a bare question draws its `question` field as ordinary reply prose above the options, so the proposal is the `question` field itself, verbatim, and only the proposal, with the braces filled from what you read:

Now that your agent is integrated, I think we should write some tests for it: scenario tests prove your agent handles the conversations it exists for, and each run is traced so you see every step. The first one I'd write is {title}, because {reason}.

Options, in this order, with the same `{title}`:

1. Create "{title}" as your first scenario test
2. "Chat about this", quiet

The first scenario is the agent's golden path: the thing the agent exists to do, end to end, with inputs the code accepts. Refusals, expired inputs and edge cases come in the suite after it, never first. `{title}` names that path in a few words, for example "Guest completes checkout"; `{reason}` says in one clause why it goes first. Its criteria name what the person can see in the conversation, never the tool that produces it: "returns an order number", not "calls place_order". The judge reads the transcript; a criterion that names a tool sends it to the traces for proof the trace may not carry, and a run the agent passed comes back failed.

**"Chat about this"**: say the line below with `say`, verbatim and in full, and end the turn right after that call, so the composer takes the cursor and the turn waits for their description. The line is the whole of the turn's words: no reply text before or after it, no other tool call, and never an empty turn in its place:

Of course. Tell me what the scenario should cover and I'll write it with you.

After that pick, their next message describes the scenario. Write it with them, then continue at step 4 with what they agreed.

### 4. The checklist, then create, explain, run

The answer to the question is the go. On the create option, or on the scenario agreed after "Chat about this", the next thing you do is this list, then the first command: no sentence between the answer and them, and nothing from step 2 said again; a reply that only speaks after the answer ends the turn with the path open. So, before any command, write this list into `todowrite`, in this order and these words, every item pending:

1. Create the first scenario
2. Open it beside the panel
3. Why a scenario, and run it
4. The two-things line
5. The remaining scenarios
6. The suite
7. Run the suite
8. Open the suite run
9. Commit and push, when a file changed since the pull request
10. Complete-path, then the closing line

Mark each item done as you finish it, and read the list before you end a turn: **a turn never ends with an open item**, unless a command answered an error (see "When a step fails"). A missing remote, a missing `gh` login and a failed verdict are not errors: the step is done with its line, and the next one starts.

Item 1:

```bash
langwatch scenario create "<title>" --situation "<the user's situation>" --criteria "<criterion one>,<criterion two>" --format json
```

Item 2, as its own command, never chained:

```bash
langwatch navigate open <scenario_id>
```

The scenario editor drawer opens beside the panel with the draft in it, and the panel stays open.

Item 3 is one step: the two lines below, each said with `say`, verbatim, then the run in the same step. Never end the turn on the running line: a turn that ends there ran nothing.

Before I run it, why a scenario and not a plain test? A scenario is a simulated user talking to your agent turn by turn while a judge checks the outcome, so one run covers a whole conversation instead of a single input and output. And tracing captures every step underneath while it runs.

Running it against your agent now.

```bash
langwatch scenario run <scenario_id> --target connected:<agent name> --wait --format json
```

### 5. From one run to a suite

Item 4: a run that answers a verdict, passed or failed, gets the two-things line. **If the run failed**, the explanation comes first, said with `say`: in plain words what the judge saw and why the agent did not meet the criteria, pointing at the run so they can replay the conversation. A failed first run is a finding, not a blocker: the agent answered and the traces flowed, which is what the line says. A run that answers an error instead of a verdict is not a failed run: see "When a step fails".

Say with `say`, verbatim:

That one run just proved two things: your agent answers scenarios, and traces are flowing in. Let me add a few more scenarios so every change you ship gets checked against real conversations.

Items 5 to 8, without another question:

```bash
langwatch test-suite create "Full regression" --format json
langwatch scenario create "<title>" --situation "..." --criteria "..." --test-suite <suite_id> --format json   # three or four more, each a different path through the agent
langwatch test-suite run <suite_id> --target connected:<agent name> --wait --format json
langwatch navigate open <the scenariorun_ id the suite run printed>
```

Every scenario of the suite carries, in its situation, the concrete input it hinges on, read from the code: the discount code, the card number the code declines, the id. A situation that says only "a card that is declined" leaves the simulated user to invent a number the code accepts, and the run fails for the wrong reason. Read the file that holds the rule before writing the situation. The criteria name outcomes, as for the first scenario, never tools.

Item 9: the commit and the pull request exist since step 2, so commit and push again only when a file changed since; the change lands on the same pull request, and with no remote it stays on the branch. Leave the branch checked out: the agent you started runs on it.

Item 10, only once item 8 is done, so the suite ran and its run is open, and never before. Close the path first:

```bash
langwatch onboarding complete-path llmops
```

Then, in the same step, say with `say`, verbatim, as the last thing the turn does, and stop, with no reply text after it:

All ready! Let me know if there is anything I can help with.

### When a step fails

A step fails when a command answers an error, never when a judge answers a verdict: a scenario or suite run that comes back failed is a finding about the agent, and step 5 goes on with the explanation, the two-things line and the suite. The credentials call answers that the key was refused, the tracing edit cannot be applied, the agent is not online after two minutes, or a scenario or suite run answers an error instead of a verdict (a 422, a target it cannot find, a run that never starts, a connected agent call that times out): stop there, without diagnosing. No further reads or commands, and never the env file: say in one line, with `say`, what is not done and what the error names as the cause, and end the turn with the open items left open. One exception to the reads, with one repair in it: when the agent is not online after two minutes, the cause is in the agent process itself, so read the log the background command named (`local_read` on the path its result printed). When its last lines name a cause in your own work of this step, a module that is not installed, an import or syntax error in a file you edited, a name the adapter got wrong, fix that cause, start the agent again the same way and run the wait once more, with the same timeout. A log that shows a clean start, the server up and no exception, with the row never online means the adapter did not register with the SDK, which is your own work of this step too: the repair is to rewrite the adapter as the SDK connect call of item 3, start the agent again and run the wait once more. The repair happens once and never touches the env file or reads the key: a second failed wait, or a cause outside those edits, stops there as this section says, and you report its last lines, the exception if there is one, as the reason. Never a guess about the CLI, the login or the project in its place. Nothing later in the script happens: no scenario or suite runs against an agent that is not online, the why-a-scenario line, the two-things line and the closing line are not said, and `langwatch onboarding complete-path` does not run. When the credentials call was refused, the line says that LANGWATCH_API_KEY and LANGWATCH_ENDPOINT go into the env file by hand, from the project's settings page.

## coding: Coding agents

Say with `say`, verbatim, with the command block as part of the copy:

You're a developer, so this one is easy. Run this in any repo where you use Claude Code:

```bash
npx langwatch claude
```

Then, in the same step, close the path:

```bash
langwatch onboarding complete-path coding
```

Then say with `say`, verbatim, as the last thing the turn does, and stop:

Then I can show you around once your first traces are flying through.

## gateway: Gateway

Three cases, checked in this order. The first that matches is the whole path; the ones after it never run. Read the `Virtual key:` line of the brief before any tool call.

1. **The brief carries a reveal id.** The line reads "Virtual key: production-app is live (preview ..., reveal id ...). Show it with secret_snippet using this reveal id. Do not list, ask or create keys." Do exactly that. The tour minted the key, and the reveal id in hand is what shows its secret: the `Virtual key:` line of the brief carries its name, its preview and its reveal id, and that is where they come from. Say nothing about the key having existed; open with the line below as if it were just made. No list, no question, no minting: go straight to "Show the key" with the brief's reveal id and preview. `langwatch virtual-keys list` is never run while the brief names a reveal id; there is nothing to check, the key is in hand.
2. **No reveal id in the brief, and the key exists.** Only now, with the brief saying none was minted, run `langwatch virtual-keys list --format json`. When a row is named `production-app`, its secret was shown once, at creation, and cannot be shown again: go to "No reveal id in hand: ask first".
3. **No reveal id in the brief, and no key.** No row is named `production-app`: mint it.

```bash
langwatch virtual-keys create --name production-app --reveal-once --format json
```

The output carries `reveal_id` and `preview`, never the secret. Go to "Show the key" with them.

Never mint a second key while the brief carries a reveal id, and never mint while a `production-app` row exists without asking first.

### Show the key

You never see the secret, and you never print it: never write a value that starts with `vk-lw-` in a message, and never write the snippet yourself. The `secret_snippet` card shows it to the user, once, and masks it afterwards.

The gateway address is the value after `Gateway:` in the brief, exactly as it stands there, never a host you remember: an instance serves its own.

Never write a placeholder in a snippet: no angle brackets, no "your key here", nothing that stands in for a value. A snippet is either complete, with the key shown through the card, or it is described in words, as below.

Say with `say`, verbatim:

Your key production-app is live. Point your app at the gateway with it and every call gets budgets, routing and tracing for free:

Then, in the same step and right after the line, call `secret_snippet` with the reveal id, the preview, and this template, the gateway address filled in and `{{secret}}` left exactly as it is:

```
export OPENAI_BASE_URL=the address after Gateway: in the brief, in double quotes
export OPENAI_API_KEY="{{secret}}"
```

When the brief says no gateway is configured, skip the snippet and say in one line, with `say`, that the gateway is not set up on this instance yet.

Then, in the same step, close the path:

```bash
langwatch onboarding complete-path gateway
```

Then say with `say`, verbatim, as the last thing the turn does, and stop:

That's it from me. I will leave you to save the key somewhere safe, and let me know if there is anything I can help with.

### No reveal id in hand: ask first

Reached only from case 2: the brief carries no reveal id and a `production-app` row exists. Do not open with the live line. Say with `say`, verbatim, then ask with the `question` tool:

Your production-app key was created earlier and its secret was shown once, at creation. Do you still have it?

Options, in this order:

1. "Create a new key"
2. "I saved it"

On "Create a new key": mint one with `--reveal-once` as above, using the next free name (`production-app-2`, then `-3`), say the live line with `say`, with that name, and show the snippet through the `secret_snippet` card with the reveal id the create printed.

On "I saved it": there is no card to show, so describe the two lines instead of writing a snippet. Say, with `say`, that the app needs two environment variables: `OPENAI_BASE_URL` set to the gateway address (write the address itself, from the brief), and `OPENAI_API_KEY` set to the production-app key they saved. Write the address in full and the key line in words; never put a value in angle brackets or a stand-in where the key goes.

Either way, in the same step, close the path:

```bash
langwatch onboarding complete-path gateway
```

Then say with `say`, verbatim, as the last thing the turn does, and stop:

That's it from me. I will leave you to save the key somewhere safe, and let me know if there is anything I can help with.

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

Then, in the same step, close the path:

```bash
langwatch onboarding complete-path governance
```

Then say in one line, with `say`, which source to add first on that page, as the last thing the turn does, and stop.
