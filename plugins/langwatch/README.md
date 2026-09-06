# LangWatch agent plugin

One plugin directory, installable by two ecosystems.

- **Claude Code** reads `.claude-plugin/plugin.json` and the hooks beside it.
- **Any [Agent Plugins 1.0](https://agent-plugins.org) client** reads the root
  `plugin.json` and the `skills/` directory.

## What it does

**Session context capture.** At the start of a session and at the end of every
turn, the plugin records which repository, branch and worktree the session is
working in, and posts it to LangWatch as a single log record. That is what lets
a coding-agent session's traces be joined to the code it worked on.

It reports repository identity only: origin remote host, owner and name, the
current branch, and the worktree name. It does not read, send or index your
code. It posts nothing when the CLI is not signed in, nothing outside a git
repository, and nothing when the context has not changed since the last post. It
never writes to the session's output and never fails a session.

**A skill.** `skills/langwatch` teaches the agent to read traces back with the
`langwatch` CLI: search, fetch a trace, print a coding-agent transcript, list a
session's events.

The hook script (`scripts/session-context.mjs`) is bundled into the plugin as a
single file with no dependencies. It does not call the globally installed
`langwatch` CLI, so upgrading, downgrading or removing that CLI cannot change
what an installed plugin does.

## Install

In Claude Code:

```bash
claude plugin marketplace add langwatch/agent-plugin
claude plugin install langwatch@langwatch
```

`langwatch claude` sets this up for you, so you only need the commands above if
you are wiring it by hand.

In an Agent Plugins client, install this directory the way that client installs
portable plugins. Portable installs get the skill; hooks are a Claude Code
feature and are ignored elsewhere.

## Sign in

The hook posts to whichever control plane the CLI is signed in to, using the
ingest key stored in `~/.langwatch/config.json`. Without one, it stays quiet.

```bash
langwatch login
```

An `OTEL_EXPORTER_OTLP_ENDPOINT` (or the logs-specific variable) in the
environment takes precedence over the signed-in control plane, so an existing
collector keeps receiving the record.

## Uninstall

```bash
claude plugin uninstall langwatch@langwatch
claude plugin marketplace remove langwatch
```

## Where the source lives

This repository is published from
[`langwatch/langwatch`](https://github.com/langwatch/langwatch) under
`plugins/langwatch`. Open issues and pull requests there.
