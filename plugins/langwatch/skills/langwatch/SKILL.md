---
name: langwatch
description: Read LLM traces back from LangWatch with the langwatch CLI. Use when asked what an agent, prompt or model call actually did in production, when debugging a failed or slow LLM run, when looking up a trace or session by id, or when checking whether this coding session's own activity was captured.
---

# LangWatch from a coding session

LangWatch stores the traces your application and your coding agent emit. The
`langwatch` CLI reads them back. Every lookup below is read-only; the one
command that writes anything is `langwatch login`, which stores credentials on
this machine.

## Check the CLI is there and signed in

```bash
langwatch --version
langwatch whoami
```

`whoami` prints the identity `langwatch login` persisted. If it reports nobody,
run `langwatch login` and let the user complete it in the browser. Do not guess
credentials.

## Find a trace

Search the last 24 hours by default. Widen with `--start-date` / `--end-date`.

```bash
langwatch trace search -q "checkout agent" --limit 10 -o json
```

Useful flags: `--limit <n>`, `--origin <origins>` (comma-separated, e.g.
`application,evaluation,simulation`).

## Read one trace

```bash
langwatch trace get <traceId> -o json
```

For a coding-agent trace, the transcript is the readable form: what the agent
did, in order.

```bash
langwatch trace transcript <traceId>
```

Add `-o json` to either when you want to parse the result rather than read it.

## Read one coding-agent session

```bash
langwatch session events <sessionId>
```

Lists the session's model calls, compactions, rate limits and tool runs in time
order. `--kinds model_call,compaction` narrows it.

## How sessions get captured

`langwatch ingest hook <tool>` is the command a coding agent runs at the start
and end of a session. It reports the repository, branch and worktree the session
is working in, so the agent's traces can be joined to the code they touched.
This plugin ships that hook, so an installed plugin needs nothing on PATH for
the capture to happen.

Nothing here sends the user's code anywhere. The hook reports repository
identity, not file contents.

## When a command fails

Read the error. A missing trace id, an expired session and a self-hosted
endpoint the CLI was never pointed at all fail differently, and the CLI says
which. Do not retry a failed read in a loop.
