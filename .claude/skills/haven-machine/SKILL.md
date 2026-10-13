---
name: haven-machine
description: "Run heavy commands under haven's machine-wide slots and the agent gate: `haven machine run`, `haven machine slot`, `haven machine typecheck`, `haven gate`, `haven self setup gate-hook`, `haven self upgrade`. Use when someone says 'haven machine run', 'haven run', 'haven slot', 'haven typecheck', 'haven machine slot', 'the check slot', 'haven machine typecheck', 'typecheck under the RAM slot', 'haven gate', 'PreToolUse hook', 'the gate refused my command', 'why is my test queued', 'CHECK_SLOTS', 'haven self upgrade', or 'reinstall the haven binary'."
user-invocable: true
argument-hint: "machine run --sh '<cmd>' | machine slot run -- <cmd> | machine typecheck | gate | self upgrade"
---

# haven slots, typecheck and the gate

Heavy commands queue through a machine-wide slot so parallel runs cannot take the machine. A queued
run says so on stderr: that is a wait, not a hang. Do not bypass it with a raw `tsc -b`.

```bash
haven machine typecheck                            # both scopes run the same root incremental `pnpm typecheck` under the slot
haven machine typecheck --affected                 # the agent default; same run (tsc rechecks only what changed)
haven machine typecheck --all                      # the human default; same run
haven machine slot run --label tests --timeout 10m -- pnpm test:unit   # any command under the check slot; exit 66 on timeout
haven machine slot explain                         # explain the slot policy and its current state
haven machine run --sh 'pnpm test:unit'    # the heavy pool; one quoted argument so operators stay in the slot
```

`haven machine run` flags: `--class heavy` (the only pool). Other `typecheck` args are forwarded. Knobs: `CHECK_SLOTS`, `CHECK_PRESSURE`, `HAVEN_TYPECHECK_SLOTS`,
`HAVEN_TYPECHECK_MAX_RSS_MB` (kills a run over 6 GiB or 10 minutes), `HAVEN_TEST_WORKERS`,
`CHECK_QUEUE_HELD` (set to the holder's pid inside a run: already admitted, so nested haven commands do not queue again). See `haven-env`.

## Machine settings

```bash
haven machine settings                                   # list: observability, runtime-auto-stop, runtime-idle-grace-minutes
haven machine settings set observability off             # stop the o11y stack now; the daemon keeps it down, stacks get no OTLP env
haven machine settings set runtime-auto-stop on          # stop the colima VM (whoever started it) once unused for the grace
haven machine settings set runtime-idle-grace-minutes 15 # 1..1440, default 10; `unset <name>` restores a default
```

Saved in haven's home (`machine-settings.json`); the hub's Settings page has the same toggles.
Auto-stop never stops the VM while any container runs on it. Docker Desktop is not stopped.

## The gate

`haven gate` answers a coding-agent PreToolUse hook on stdin (`--client claude`, the default, or
`codex`). It is opt-in: `haven self setup gate-hook` installs it (`haven self setup --list`; `--off` removes it).
It queues heavy commands and refuses ones an agent may not run (a `haven up --force` or
`make haven self install` on a stack testers drive). A refused command is not rephrased: mark the step
blocked and hand it to the user.

## Binary and no-ops

- `haven self upgrade` reinstalls the haven binary from this checkout. Not for agents to run unasked.
