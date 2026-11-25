---
name: setup-lw
description: Set up and troubleshoot the LangWatch CLI, covering login (cloud and self-hosted), endpoint configuration, project selection, and connection problems. Use when the CLI isn't authenticated, can't reach LangWatch, or talks to the wrong project.
license: MIT
compatibility: Requires the `langwatch` CLI (`npm install -g langwatch` or `npx langwatch`). Works with any coding agent.
metadata:
  category: recipe
---

# Set Up the LangWatch CLI

## Step 1: Credentials

IMPORTANT: You will need a LangWatch API key. Check whether LANGWATCH_API_KEY is already set: in the process environment, which is where CI injects it, and otherwise in the project's .env file. Use that key instead of asking for a new one. Read LANGWATCH_ENDPOINT from the same places, and nothing else out of .env: if the endpoint is set, the project is on a self-hosted instance, and the CLI works against that endpoint instead of app.langwatch.ai.

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
