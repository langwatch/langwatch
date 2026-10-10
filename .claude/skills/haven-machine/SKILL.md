---
name: haven-machine
description: "Run heavy commands under haven's machine-wide slots and the agent gate: `haven run`, `haven slot`, `haven typecheck`, `haven gate`, `haven setup gate-hook`, `haven upgrade`, `haven hmr`. Use when someone says 'haven run', 'haven slot', 'the check slot', 'haven typecheck', 'typecheck under the RAM slot', 'haven gate', 'PreToolUse hook', 'the gate refused my command', 'why is my test queued', 'CHECK_SLOTS', 'haven upgrade', or 'reinstall the haven binary'."
user-invocable: true
argument-hint: "run --sh '<cmd>' | slot run -- <cmd> | typecheck [--affected|--all] | gate | upgrade"
---

# haven slots, typecheck and the gate

Heavy commands queue through a machine-wide slot so parallel runs cannot take the machine. A queued
run says so on stderr: that is a wait, not a hang. Do not bypass it with a raw `tsc -b`.

```bash
haven typecheck --affected                 # nx affected -t typecheck from the merge-base (the agent default)
haven typecheck --all                      # the whole-tree pnpm typecheck (the human default)
haven slot run --label tests --timeout 10m -- pnpm test:unit   # any command under the check slot; exit 124 on timeout
haven slot explain                         # explain the slot policy and its current state
haven run --sh 'pnpm test:unit'            # the heavy pool; one quoted argument so operators stay in the slot
```

`haven run` flags: `--class heavy` (the only pool), `--agent-id <id>` (shorter wait ceiling for an
agent's prompt cache), `--workers <n>` (narrowed to n test workers). Other `typecheck` args are
forwarded. Knobs: `CHECK_SLOTS`, `CHECK_PRESSURE`, `HAVEN_TYPECHECK_SLOTS`,
`HAVEN_TYPECHECK_MAX_RSS_MB` (kills a run over 6 GiB or 10 minutes), `HAVEN_TEST_WORKERS`,
`HAVEN_SLOT_HELD` (set inside a run: already admitted). See `haven-env`.

## The gate

`haven gate` answers a coding-agent PreToolUse hook on stdin (`--client claude`, the default, or
`codex`). It is opt-in: `haven setup gate-hook` installs it (`haven setup --list`; `--off` removes it).
It queues heavy commands and refuses ones an agent may not run (a `haven up -f` or
`make haven install` on a stack testers drive). A refused command is not rephrased: mark the step
blocked and hand it to the user.

## Binary and no-ops

- `haven upgrade` reinstalls the haven binary from this checkout. Not for agents to run unasked.
- `haven hmr [on|off|status]` is a retired no-op (reloads are debounced, there is no hold, ADR-168).
