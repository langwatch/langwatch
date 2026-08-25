---
name: setup-lw
description: Set up and troubleshoot the LangWatch CLI, covering login (cloud and self-hosted), endpoint configuration, project selection, and connection problems. Use when the CLI isn't authenticated, can't reach LangWatch, or talks to the wrong project.
license: MIT
compatibility: Requires the `langwatch` CLI (`npm install -g langwatch` or `npx langwatch`). Works with any coding agent.
metadata:
  category: recipe
---

# Set Up the LangWatch CLI

Get the CLI authenticated and talking to the right LangWatch project, then verify. The troubleshooting table at the end covers the common failure modes.

## Step 1: Credentials

IMPORTANT: You will need a LangWatch API key. Check if LANGWATCH_API_KEY is already in the project's .env file. Use that key instead of asking for a new one. If they have a LANGWATCH_ENDPOINT in .env, they are on a self-hosted instance, so use that endpoint instead of app.langwatch.ai.

For CI and agents, configure non-interactively, and never block on a browser. Have the runner inject the key from your secret store into `LANGWATCH_API_KEY`, which is what the CLI reads:

```yaml
# GitHub Actions; any secret store works the same way
env:
  LANGWATCH_API_KEY: ${{ secrets.LANGWATCH_API_KEY }}
  LANGWATCH_ENDPOINT: https://lw.acme.internal # self-hosted only; omit for cloud
```

That variable is the whole of the CI setup: every command resolves the key from the environment, so there is no `login` call to make. Keep the key off the command line: an argument is readable by every other process on the machine, and in a shell it lands in your history file.

Locally, run plain `langwatch login`. It asks where you are logging in (cloud or self-hosted) and how you will use LangWatch (AI tools, project SDK key, or both), then finishes in the browser. No credential is ever typed or pasted into the terminal: you pick the project on the approval page and its key comes back to the CLI over the same channel, so none of it reaches your shell history. A project SDK key lands as `LANGWATCH_API_KEY` in `.env` in the current directory, so keep `.env` out of version control; an AI-tools login lands in `~/.langwatch/config.json`. `langwatch login --device` skips the questions and goes straight to that RFC 8628 device flow via company SSO.

`langwatch login --api-key <key>` writes a key you already hold straight to `.env`, with no browser and no prompts. It is the only non-interactive way to hand `login` a key, and the key travels through the process argument list, so it is not how a runner should supply one: with `LANGWATCH_API_KEY` set the CLI already has the key, and the flag adds nothing but the file. Reach for it when something downstream genuinely needs the key on disk. It rewrites an existing `LANGWATCH_API_KEY` line rather than adding a second one, which is why it beats appending to `.env` from a shell: a second line makes the credential ambiguous, and one re-run of an append is all it takes to get one.

`langwatch login --project <slug>` writes a project's key to `.env` with no key on the command line either, but it authenticates through an existing device login, so it suits a developer machine or a long-lived agent box rather than a fresh CI runner.

`--endpoint https://lw.acme.internal` combines with any of these to pin a self-hosted instance. It pins the CLI; your instrumented app reads `LANGWATCH_ENDPOINT` from the environment, so a self-hosted setup needs both.

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
langwatch status          # resource counts: proves auth + endpoint + project in one shot
```

`langwatch status` printing resource counts means the setup is done. Everything else (traces, evaluations, scenarios) builds on this.

## Step 4: Discover What You Can Do

## Troubleshooting

| Symptom                                 | Likely cause                                    | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401` / `unauthorized` on every command | Wrong, revoked, or missing API key              | Re-run `langwatch login`; check `LANGWATCH_API_KEY` in `.env` and the shell (shell wins)                                                                                                                                                                                                                                                                                                                                                          |
| `401` with a PAT                        | Missing project id                              | `export LANGWATCH_PROJECT_ID=<your-project-id>`                                                                                                                                                                                                                                                                                                                                                                                                   |
| Connection refused / DNS errors         | Self-hosted endpoint wrong or unreachable       | Check `langwatch config get endpoint` and `LANGWATCH_ENDPOINT`; verify the instance URL loads in a browser from this machine                                                                                                                                                                                                                                                                                                                      |
| Right credentials, wrong data           | Talking to the wrong project or instance        | `langwatch projects list`; re-login with a key from the intended project                                                                                                                                                                                                                                                                                                                                                                          |
| Old shell ignores new `.env`            | Env vars already exported                       | Start a new shell, or `unset LANGWATCH_API_KEY LANGWATCH_ENDPOINT` so `.env` is re-read                                                                                                                                                                                                                                                                                                                                                           |
| A command hangs waiting for input       | Interactive prompt in a non-interactive context | No flag answers prompts globally. Set `LANGWATCH_API_KEY` so nothing needs `login`, then pass the flag that command takes: `--force` for `prompt tag delete`, `--force-local` or `--force-remote` for `prompt push`, `-y` for `logout`, `skills install`, `skills uninstall` and `skills update`. `-o json` only selects an output format; on `skills` it turns the confirmation into an error rather than a prompt, elsewhere it changes nothing |
