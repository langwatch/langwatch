# diffsuite

Runs the diff tools (apidiff, visualdiff, fuzz) together and stops them all
when one stopping is a sign the rest are wasting time.

```bash
go build -o .bin/diffsuite/diffsuite ./cmd/diffsuite
.bin/diffsuite/diffsuite -out .claude/tmp/runs/x -policy half -health http://localhost:5560/api/health -- \
  api='.bin/apidiff/apidiff ...' ui='.bin/visualdiff/visualdiff ...'
```

- Each tool runs as `bash -c '<command>'` in its own process group, all at once. Output goes to
  `<out>/<name>.log`; `<out>/events.log` gets the FAIL/ERROR/tally/panic/fatal lines as `[name] ...`,
  `[name] EXIT <code>` per tool and `all runs ended: ...` last; `<out>/summary.json` has each tool's
  exit, stop reason and cause, duration and the verdict.
- A tool exiting 3 has stopped (`diffkit.ExitStopped`). The reason is the text after the last `stopping: `
  in its output, and it is put in one cause class: sign-in, stack-unreachable, browser-closed, timeout, other.
- `-policy`: `half` (default) cancels the rest when half the tools have stopped, or two stopped with the same
  non-`other` cause; `same-cause` only the second rule; `any` on the first stop; `none` never.
- Cancel is SIGTERM to each group, SIGKILL after 20 s, logged as `diffsuite: stopping all: <reason>`.
- `-health <url>` must answer 2xx to start, is polled every 30 s, and three failures in a row stop all
  ("stack unhealthy").
- Exit: 0 all passed; 3 stopped by policy or health; else the highest tool exit code.
