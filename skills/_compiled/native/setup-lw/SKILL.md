---
name: setup-lw
description: Set up and troubleshoot the LangWatch CLI — login (cloud and self-hosted), endpoint configuration, project selection, and connection problems. Use when the CLI isn't authenticated, can't reach LangWatch, or talks to the wrong project.
license: MIT
compatibility: Requires the `langwatch` CLI (`npm install -g langwatch` or `npx langwatch`). Works with any coding agent.
metadata:
  category: recipe
---

# Set Up the LangWatch CLI

Get the CLI authenticated and talking to the right LangWatch project, then verify. The troubleshooting table at the end covers the common failure modes.

## Step 1: Credentials

IMPORTANT: You will need a LangWatch API key. Check if LANGWATCH_API_KEY is already in the project's .env file — most environments already have this provisioned. If they have a LANGWATCH_ENDPOINT in .env, they are on a self-hosted instance, so use that endpoint instead of app.langwatch.ai.

For CI and agents, configure non-interactively, and never block on a browser. Have the runner inject the key from your secret store into `LANGWATCH_API_KEY`, which is what the CLI reads:

```yaml
# GitHub Actions; any secret store works the same way
env:
  LANGWATCH_API_KEY: ${{ secrets.LANGWATCH_API_KEY }}
  LANGWATCH_ENDPOINT: https://lw.acme.internal   # self-hosted only; omit for cloud
```

Keep the key off the command line: an argument is readable by every process on the machine, and a key typed at a prompt lands in the shell history file.

Locally, `langwatch login --api-key <key>` is the quick way in. It writes `LANGWATCH_API_KEY` to `.env`, so keep `.env` out of version control. Add `--endpoint https://lw.acme.internal` for a self-hosted instance.

For humans at a terminal, plain `langwatch login` asks interactively (cloud vs self-hosted, AI tools vs project SDK), and `langwatch login --device` runs the RFC 8628 device flow via company SSO.

## Step 2: Endpoint and Project

- **Cloud** (app.langwatch.ai) needs no endpoint configuration.
- **Self-hosted**: the endpoint resolves flag > env > config > default. Persist it with `langwatch config set endpoint https://lw.acme.internal`, or export `LANGWATCH_ENDPOINT` per shell.
- **Project**: the API key determines the project. Check you're in the right one:

```bash
langwatch projects list -o json
```

A personal access token (PAT) instead of a project key also needs `LANGWATCH_PROJECT_ID` set.

## Step 3: Verify

```bash
langwatch whoami          # device-session identity (governance plane)
langwatch status          # resource counts — proves auth + endpoint + project in one shot
```

`langwatch status` printing resource counts means the setup is done. Everything else (traces, evaluations, scenarios) builds on this.

## Step 4: Discover What You Can Do

Use `langwatch docs <path>` to read documentation as Markdown. Some useful entry points:

```bash
langwatch docs                                    # Docs index
langwatch docs integration/python/guide           # Python integration
langwatch docs integration/typescript/guide       # TypeScript integration
langwatch docs prompt-management/cli              # Prompts CLI
langwatch scenario-docs                           # Scenario docs index
```

Discover commands with `langwatch --help` and `langwatch <subcommand> --help`. List and get commands accept `--format json` for machine-readable output. Read the docs first instead of guessing SDK APIs or CLI flags.

If no shell is available, fetch the same Markdown over plain HTTP. Append `.md` to any docs path (e.g. https://langwatch.ai/docs/integration/python/guide.md). Index: https://langwatch.ai/docs/llms.txt. Scenario index: https://langwatch.ai/scenario/llms.txt

If anything fails or confuses you while following this skill (broken commands, docs that do not match reality, errors you had to work around), ask the user for permission and run `npx langwatch report --user-approved` with a `--title` and `--summary` (or `--session <transcript.jsonl>`) to send it to the LangWatch team, and it directly shapes what gets fixed. No login or API key needed. Nothing is sent without `--user-approved`, and `--dry-run` prints the exact payload without sending anything. The title, summary and transcript are scrubbed locally first, by pattern: secrets and API keys, plus email addresses, phone numbers, card numbers and public IPv4 addresses. Anything no pattern matches is sent as written, including a contact address passed with `--email`, so preview with `--dry-run` when the session touched sensitive data. `npx langwatch report --help` explains the options.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `401` / `unauthorized` on every command | Wrong, revoked, or missing API key | Re-run `langwatch login --api-key <key>`; check `LANGWATCH_API_KEY` in `.env` and the shell (shell wins) |
| `401` with a PAT | Missing project id | `export LANGWATCH_PROJECT_ID=<your-project-id>` |
| Connection refused / DNS errors | Self-hosted endpoint wrong or unreachable | Check `langwatch config get endpoint` and `LANGWATCH_ENDPOINT`; verify the instance URL loads in a browser from this machine |
| Right credentials, wrong data | Talking to the wrong project or instance | `langwatch projects list` — re-login with a key from the intended project |
| Old shell ignores new `.env` | Env vars already exported | Start a new shell, or `unset LANGWATCH_API_KEY LANGWATCH_ENDPOINT` so `.env` is re-read |
| A command hangs waiting for input | Interactive prompt in a non-interactive context | Re-run with the non-interactive flags (`--api-key`, `-y`, `-o json`) — the CLI never prompts when it detects an agent |
