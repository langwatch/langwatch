---
name: haven-lifecycle
description: "Start, stop, reconcile and clean up haven stacks: `haven up`, `down`, `restart`, `reload`, `status`, `destroy`, `clean`, `install`, `setup`, `switch`, `shell-init`, lanes, +svc/-svc, the UI modes (built, bundled, dev) and the hold. Use when someone says 'haven up', 'start the stack', 'stop the stack', 'haven down', 'restart the api lane', 'haven reload', 'hold the stack', 'add a service', 'haven up +langy', 'built or bundled UI', 'haven status', 'haven destroy', 'haven clean', 'free disk from worktrees', 'haven install', 'haven setup', 'haven switch', or 'a stack is running somewhere else'."
user-invocable: true
argument-hint: "[up | down | restart <lane> | reload | status | destroy <slug> | clean | install]"
---

# haven lifecycle

Run from the workspace root. `make haven <sub>` forwards to the CLI (`dev/haven.mk`).

```bash
haven up --agent -d               # start; bare `haven up` without a TTY never returns and dies with your shell
haven status --agent              # every stack, service health, shared servers, RAM (--json, --reveal)
haven down                        # stop this stack, keep databases
haven down --all                  # every stack, shared servers, daemon and proxy; -f kills hard
haven restart sims                # bounce one lane; nothing else restarts (--rebuild for an image)
haven reload                      # apply changes to a held stack; waits for "reload finished"
haven destroy <slug> --yes        # stop a stack and DROP its databases (ask first, see haven-db)
```

Check `haven status`, then the URL; `haven up` returning is not health.

## up flags and services

```bash
haven up +langy -mail             # add or drop a service; sticky
haven up +langevals               # evaluators (monitors, evaluations)
haven up +llm                     # zero-cost model answers (llmsim)
haven up +design-system +mail-room  # the Storybook and the mail studio
haven up -f                       # restart even when the stack already matches
haven up --no-seed                # skip the auto-seed of an empty stack (haven-seed)
haven up --mode <mode>            # a deployment mode from dev/tests/modes; sticky, `none` clears
haven up --rebuild                # rebuild container images even when unchanged
```

`-w/--watch` (default on) rebuilds Go, reloads Node and rebuilds the built UI; `--watch=false` holds
the stack (sticky). The simulators are `+name` services too: `haven sims` lists them (`sims` skill).
Do not run `haven up` or `down` on a checkout another session uses without asking; as an agent a
`haven up -f` or `make haven install` on a stack that testers drive is refused by the safety check.

## Lanes

`ui`, `api`, `go` (gateway and nlp), `sims`, `langy`. The api lane hosts the worker, so
`haven logs api` and `haven logs worker` each show half of it. Under the default, ui, api and
worker are one `app` lane: see `dev-runtime`. The `go` lane also hosts the simulators and no
`sims` lane runs; `LANGWATCH_DEV_ONE_PROCESS=0` splits both (`LANGWATCH_GO_ONE_PROCESS` is a
deprecated alias). The Go lane rebuilds and swaps its child on a Go change;
`LANGWATCH_GO_WATCH=0` or `haven up --watch=false` turns that off; `haven logs <sim>` still reads
each one. Langy stays its own lane.

```bash
haven restart api                 # restart the whole lane
haven up --watch=false -f         # hold the stack (sticky): no Go rebuild, no backend reload, no UI rebuild
haven reload [app|api|worker]     # apply changes to the held stack in place
haven reload ui                   # built UI: rebuild the bundle and swap it in
```

## UI modes

```bash
haven up                          # default: built UI served by the api, no Vite; --watch rebuilds what changed
haven up --ui=bundled -f          # editing and testing visually: Vite 8 bundled dev, HMR kept (sticky)
haven up --ui=dev -f              # almost never: unbundled Vite, thousands of requests per page (sticky)
haven up --ui=built -f            # back to the default
```

Watching (the default), a built stack runs a `ui` lane: Vite's `build --watch` kept warm, each
finished rebuild swapped in whole, so the next page load is the new UI (no HMR). `haven logs ui`
shows each rebuild; a failed rebuild keeps the last good bundle. On a fresh checkout the first
`haven up` builds the bundle once.

|             | dev          | built                         |
| ----------- | ------------ | ----------------------------- |
| Role        | almost never | testing without changing code |
| Page memory | 708 MB       | 396 MB                        |
| JS heap     | 242 MB       | 69 MB                         |
| Requests    | 2289         | 563                           |

- The app's own process sheds the UI's Vite server too.
- There is no orb (so no `haven feedback`) and no HMR, and the app runs its production code paths.
- Old assets pile up in `apps/ui/dist/client/assets`; `rm -rf apps/ui/dist` clears them.
- A build peaks at about 4.8 GB.

## install, setup, switch, clean

```bash
make haven install                # puts plain `haven` on PATH and installs what the machine needs
haven install --list --agent      # report what is installed and missing; changes nothing
haven install --yes               # install what haven needs without asking (optional ones left alone)
haven install --build             # build the consoles and go-install haven, one line per step
haven install --reset-skips       # forget every never-ask-again
haven setup --list                # optional integrations for this checkout (e.g. gate-hook); --off turns one off
eval "$(haven shell-init)"        # the `haven switch` function and completion
haven switch <name>               # cd to a worktree by name (--list for names)
haven clean                       # picker: worktrees, then agent job scratch, then safe reclaim
haven clean --yes                 # no pickers: only the pre-tick defaults, never a database
```

- With no TTY `haven install` runs `--yes`: on macOS also the native tier (`brew install grafana
prometheus loki` and the pinned ClickHouse, Tempo and Alloy downloads). macOS needs no colima.
  Re-running is a no-op; a failed non-required row is logged and the run carries on.
- `--build` builds the consoles the binary embeds in one cached, parallel `nx run-many` (the
  `haven-console` tag is the list); a console that fails serves a page naming `make haven-web`.
- haven starts the Colima VM only when a selected lane runs in a container (container ClickHouse or
  observability, sandboxed Langy, `haven play`), records that in `colima-<profile>.json`, and stops it
  once nothing needs it (`haven status` adds "stopped by haven"). A VM you started is never stopped.
- `clean` flags: `--stale-days <n>`, `--include-recent` (agent jobs finished within 48h).
  Only agents that were asked may run `haven clean` or `haven destroy`.

Internal commands (hidden from help, spawned by haven, not for agents): `haven keep <slug>` (the stack's
keeper), `haven go-watch`, `haven simulator`, `haven static <lane> <dir> <port>` (serves a built bundle
for `+design-system` and `+mail-room`), `haven play-launch`. `haven hmr` is a retired no-op (ADR-168).
See also: `haven-env` (`limits`), `haven-logs`, `troubleshooting.md` in `haven`.
