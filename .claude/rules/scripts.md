---
paths:
  - ".github/scripts/**"
  - ".github/workflows/**"
  - "dev/scripts/**"
  - "scripts/**"
  - "tools/**"
  - "cmd/**"
---

# Scripts are Go

Every new script, whether CI, dev tooling, measurement or a one-off, is a Go
command, never TypeScript, shell or Python.

- It lives at `cmd/<name>/main.go`, with its logic in a package that has
  `go test` coverage (for example `tools/ciguard`), and a workflow runs it with
  `go run ./cmd/<name>`.
- Reuse the shared helpers in `pkg/`, such as `pkg/ciscan` for reading
  workflows, before writing a parser of your own.
- Existing `.ts` and `.sh` scripts stay until you change one substantially;
  then port it to Go in the same pull request.
- `make go-lint-changed` must pass, so keep each function's cognitive
  complexity at 10 or less.
