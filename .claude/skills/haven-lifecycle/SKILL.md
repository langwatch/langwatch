---
name: haven-lifecycle
description: "Start, stop, reconcile and clean up haven stacks: `haven up`, `down`, `restart`, `reload`, `status`, `down --destroy`, `machine clean`, `self install`, `self setup`, `switch`, `self shell-init`, lanes, +svc/-svc, the stack modes (still, --watch, --hmr). Use when someone says 'haven destroy', 'haven clean', 'haven install', 'haven setup', 'haven shell-init', 'haven up', 'start the stack', 'stop the stack', 'haven down', 'restart the api lane', 'haven reload', 'haven up --watch', 'haven up --hmr', 'add a service', 'haven up +langy', 'built UI or HMR', 'haven status', 'haven down --destroy', 'haven machine clean', 'free disk from worktrees', 'haven self install', 'haven self setup', 'haven switch', or 'a stack is running somewhere else'."
user-invocable: true
argument-hint: "[up | down | restart <lane> | reload | status | down --destroy --stack <slug> | machine clean | self install]"
---

# haven lifecycle

Run from the workspace root. `make haven <sub>` forwards to the CLI (`dev/haven.mk`).

```bash
haven up --agent -d               # start; bare `haven up` without a TTY never returns and dies with your shell
haven status --agent              # every stack, service health, shared servers, RAM (--json, --reveal)
haven down                        # stop this stack, keep databases
haven down --all                  # every stack, shared servers, daemon and proxy; --force kills hard
haven restart sims                # bounce one lane; nothing else restarts (--rebuild for an image)
haven reload                      # apply changes to a held stack; waits for "reload finished"
haven down --destroy --stack <slug> --yes        # stop a stack and DROP its databases (ask first, see haven-db)
```

Check `haven status`, then the URL; `haven up` returning is not health.

## up flags and services

```bash
haven up +langy -mail             # add or drop a service; sticky
haven up +langevals               # evaluators (monitors, evaluations)
haven up +llm                     # zero-cost model answers (llmsim)
haven up +design-system +mail-room  # the Storybook and the mail studio
haven up --force                  # restart even when the stack already matches
haven up --no-seed                # skip the auto-seed of an empty stack (haven-seed)
haven up --mode <mode>            # a deployment mode from dev/tests/modes; sticky, `none` clears
haven up --rebuild                # rebuild container images even when unchanged
```

One mode switch, never sticky (ADR-064 amendment 2026-10-10 b): plain `haven up` is still,
`--watch` rebuilds and reloads everything on a change, `--hmr` does too with Vite HMR for the UI.
Switching needs no `--force`; `--ui=...` and `--watch=false` exit 64. The simulators are `+name` services too: `haven sim` lists them (`sims` skill).
Do not run `haven up` or `down` on a checkout another session uses without asking; as an agent a
`haven up --force` or `make haven self install` on a stack that testers drive is refused by the safety check.

## Lanes

`ui`, `api`, `go` (gateway and nlp), `sims`, `langy`. The api lane hosts the worker, so
`haven logs api` and `haven logs worker` each show half of it. Under the default, api and
worker are one process: see `dev-runtime`. The `go` lane also hosts the simulators and no
`sims` lane runs; `LANGWATCH_DEV_ONE_PROCESS=0` splits both, Go and sims only (`LANGWATCH_GO_ONE_PROCESS` is a
deprecated alias). The Go lane rebuilds and swaps its child on a Go change
only under `--watch` or `--hmr`, and `LANGWATCH_GO_WATCH=0` keeps it off; `haven logs <sim>` still reads
each one. Langy stays its own lane.

```bash
haven restart api                 # restart the whole lane
haven reload [app|api|worker]     # apply changes to a still stack in place
haven reload ui                   # built UI: rebuild the bundle and swap it in
haven restart ui                  # same on a still or --watch stack (no backend restart); under --hmr it bounces the Vite lane
```

## Stack modes

```bash
haven up                          # still: built UI served by the api, no Vite, nothing reloads
haven up --watch                  # UI one-shot builds (open pages reload once idle), Node reload, Go rebuild
haven up --hmr                    # as --watch, but the UI is Vite 8 bundled dev with HMR
```

`haven status` names the mode (`refresh still|watch|hmr`, `"refresh"` in `--json`).
Still builds the bundle once at `up` (cached by Nx) and never again until `haven reload ui`;
open pages never reload. `--watch` adds a `ui` lane, `haven ui-watch`: one build per settled burst
of edits, swapped in whole (`haven logs ui` shows each; a failed build keeps the last good
bundle). An open page then reloads once nobody has touched it for 60 s, or at once when hidden.
Old chunks stay loadable for 24 h after a swap. `pnpm dev` runs the Vite dev server outside haven. Numbers for each mode: `dev/docs/LOCAL_STACK.md`.

|             | dev (`pnpm dev`) | built (still, --watch)        |
| ----------- | ---------------- | ----------------------------- |
| Role        | almost never     | testing without changing code |
| Page memory | 708 MB           | 396 MB                        |
| JS heap     | 242 MB           | 69 MB                         |
| Requests    | 2289             | 563                           |

- The app's own process sheds the UI's Vite server too.
- There is no orb (so no `haven orb feedback`) and no HMR, and the app runs its production code paths.
- Old assets pile up in `apps/ui/dist/client/assets`; `rm -rf apps/ui/dist` clears them.
- A build peaks at about 4.8 GB.

## install, setup, switch, clean

```bash
make haven self install                # puts plain `haven` on PATH and installs what the machine needs
haven self install --list --agent      # report what is installed and missing; changes nothing
haven self install --yes               # install what haven needs without asking (optional ones left alone)
haven self install --build             # build the consoles and go-install haven, one line per step
haven self install --reset-skips       # forget every never-ask-again
haven self setup --list                # optional integrations for this checkout (e.g. gate-hook); --off turns one off
eval "$(haven self shell-init)"        # the `haven switch` function and completion
haven switch <name>               # cd to a worktree by name (--list for names)
haven machine clean                       # picker: worktrees, then agent job scratch, then safe reclaim
haven machine clean --yes                 # no pickers: only the pre-tick defaults, never a database
```

- With no TTY `haven self install` runs `--yes`: on macOS also the native tier (`brew install grafana
prometheus loki` and the pinned ClickHouse, Tempo and Alloy downloads). macOS needs no colima.
  Re-running is a no-op; a failed non-required row is logged and the run carries on.
- `--build` builds the consoles the binary embeds in one cached, parallel `nx run-many` (the
  `haven-console` tag is the list); a console that fails serves a page naming `make haven-web`.
- haven starts the Colima VM only when a selected lane runs in a container (container ClickHouse or
  observability, sandboxed Langy, `haven pr --throwaway`), records that in `colima-<profile>.json`, and stops it
  once nothing needs it (`haven status` adds "stopped by haven"). A VM you started is never stopped.
- `machine clean` flags: `--stale-days <n>`, `--include-recent` (agent jobs finished within 48h).
  Only agents that were asked may run `haven machine clean` or `haven down --destroy`.

Internal commands (hidden from help, spawned by haven, not for agents): `haven keep <slug>` (the stack's
keeper), `haven go-watch`, `haven simulator`, `haven static <lane> <dir> <port>` (serves a built bundle
for `+design-system` and `+mail-room`). `haven hmr`, `haven git` and `haven play-launch` are deleted (ADR-064).
See also: `haven-env` (`machine limits`), `haven-logs`, `troubleshooting.md` in `haven`.
