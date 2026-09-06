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

The brief is the whole context. Do not run `langwatch onboarding state` to learn what it already says; run it only when a line you need is missing. It prints the same shape as the brief: `paths`, `currentPath`, `donePaths`, `provider`, `providerModel`, `tourCompletedAt`, `tourSkippedAt`.

- **Path to set up now** picks the script below: `llmops`, `coding`, `gateway` or `governance`.
- **Everything picked** is the order the user chose; the Home page offers the rest later, so set up only the current path.
- **Provider** is already connected when the brief names one. Never ask for a key.
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

  with `<path>` one of `llmops`, `coding`, `gateway`, `governance`. It is idempotent. It runs last: in the same step as the closing line, right after it, with no other tool call beside it, and never before the path's work is done. On the llmops path that is after the suite run is open and the closing line is said; on the coding and gateway paths after the snippet and the closer; on the governance path after the sources page is open and its one line is said. When it returns, the turn is over: say nothing more, and never repeat the closing line. Whatever it printed is the panel's to show, not yours.

## llmops: Evals & LLM Ops

The goal: the user's agent is traced, connected, and covered by a first scenario and a small suite, with the results open beside the panel.

### 1. Ask for the code

Say, verbatim:

Ok, let's set up your agent with LangWatch. Can I access your code? If I can see it, I can figure out your agent myself and wire everything up for you.

Then call `code_access` with `offer_describe: true` and the reason "wire tracing in and write the first scenario against your agent". The card offers the local folder, GitHub, and a quiet "I'd rather describe it". Nothing goes between the opener and the card: when the tool waits for the user, the turn is over, so say nothing more.

**If the user picks "I'd rather describe it"**, the next message reads exactly that. Say, verbatim:

No problem. What does your agent do? One line is enough.

Take their line, then say, verbatim:

Perfect. To write a scenario for that and run it against your real agent, and wire tracing in while I'm at it, I still need to reach the code. How should I connect?

and call `code_access` again, this time without `offer_describe`. Keep their description: it names the first scenario when the code is thin.

**If the folder never connects** (the wait expires with nothing shared), offer GitHub in one line and call `code_access` again. Create nothing on the project until the code is reachable.

### 2. Read the code and wire it

With the workspace facts from `code_access`, follow the `code-changes` skill to explore: the manifest, the entry point, the file that creates the LLM client or the graph. Detect the framework (LangGraph, OpenAI Agents, Vercel AI SDK, plain OpenAI, and so on) and the language.

Then, still through `code-changes`, apply two skills to the code:

1. `tracing` for the detected framework (`langwatch docs integration/<framework>`), so every call is traced.
2. `connect-agent`, so the platform can run scenarios against the agent: the connect call with a stable agent name and the environment the process runs in.

Start the agent the way the repo starts it (the `local_*` tools run the process; the connect-agent skill says how to keep it up), then read it back with `langwatch agent list --format json` until the row is `Online`. Note the agent name: every `--target` below is `connected:<that name>`.

### 3. Propose the first scenario, and stop

Do not create it yet. Ask with the `question` tool, verbatim, with the braces filled from what you read:

I read through the code. I think the first scenario we should write is {title}, because {reason}. Can I create and run it for you?

Options, in this order:

1. "Sure, go ahead!"
2. "Chat about this", quiet

`{title}` is the scenario's name in a few words, for example "Guest completes checkout". `{reason}` says in one clause why this path first: the one most users take, the one that crosses the most steps, the one the code guards hardest.

**"Chat about this"**: say, verbatim, and end the turn so the composer takes the cursor:

Of course. Tell me what the scenario should cover and I'll write it with you.

Write the scenario with them from their next message, and only then continue at step 4 with what they agreed.

### 4. Create, explain, run

On "Sure, go ahead!":

```bash
langwatch scenario create "<title>" --situation "<the user's situation>" --criteria "<criterion one>,<criterion two>" --format json
```

Then, as its own command, never chained:

```bash
langwatch navigate open <scenario_id>
```

The scenario editor drawer opens beside the panel with the draft in it, and the panel stays open. Say, verbatim:

Before I run it, why a scenario and not a plain test? A scenario is a simulated user talking to your agent turn by turn while a judge checks the outcome, so one run covers a whole conversation instead of a single input and output. And tracing captures every step underneath while it runs.

Running it against your agent now.

```bash
langwatch scenario run <scenario_id> --target connected:<agent name> --wait --format json
```

### 5. From one run to a suite

**If the run passed**, say, verbatim:

That one run just proved two things: your agent answers scenarios, and traces are flowing in. Let me add a few more scenarios so every change you ship gets checked against real conversations.

Then, without another question:

```bash
langwatch test-suite create "Full regression" --format json
langwatch scenario create "<title>" --situation "..." --criteria "..." --test-suite <suite_id> --format json   # three or four more, each a different path through the agent
langwatch test-suite run <suite_id> --target connected:<agent name> --wait --format json
langwatch navigate open <the scenariorun_ id the suite run printed>
```

**If the run failed**, explain in plain words what the judge saw and why the agent did not meet the criteria, keep going with the suite exactly as above, and point at the run so they can replay the conversation. A failing first scenario is a finding, not a blocker.

Say, verbatim, as the last line:

All ready! Let me know if there is anything I can help with.

Then, in the same step, close the path and stop:

```bash
langwatch onboarding complete-path llmops
```

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

Take the secret from the create output. When the key already existed, its secret was shown once at minting and is not readable again: say so in one line and print the snippet with `<your production-app key>` in its place.

Say, verbatim, then the snippet:

Your key production-app is live. Point your app at the gateway with it and every call gets budgets, routing and tracing for free:

```bash
export OPENAI_BASE_URL="https://gateway.langwatch.ai/v1"
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
