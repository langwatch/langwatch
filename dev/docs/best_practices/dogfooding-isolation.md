# Dogfooding the CLI against a local instance

`langwatch login`, `langwatch instrument <tool>` and `langwatch <tool>` write this
machine's global files: `~/.langwatch/config.json`, `~/.claude/settings.json` and
`~/.codex/config.toml`. Pointed at a local dev instance they replace the production
wiring for every session on the machine, not only the QA shell. The result is quiet:
agent telemetry exports to a dev port that is only up while `pnpm dev` runs, and
`langwatch ingest context` fails with connection refused and spools, so real pull
requests show no coding agent usage until someone logs in again.

Give the QA shell its own home. Export these in the shell or tmux session you
dogfood in, before the first `langwatch` command:

```bash
export LANGWATCH_CLI_CONFIG="$PWD/.claude/tmp/dogfood/langwatch-config.json"
export CLAUDE_CONFIG_DIR="$PWD/.claude/tmp/dogfood/claude"
export CODEX_HOME="$PWD/.claude/tmp/dogfood/codex"
```

They relocate the CLI config file, the Claude Code settings directory, and the codex
directory with its `config.toml` and hooks, so the global files keep pointing at
production. The CLI state directory `~/.langwatch/state` has no override yet, so
session-context spool files still land in the real home. When the endpoint resolves to
loopback and `LANGWATCH_CLI_CONFIG` is unset, `langwatch login` and `langwatch
instrument` print one warning line naming these variables.
