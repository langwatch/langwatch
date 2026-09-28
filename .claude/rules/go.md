---
paths:
  - "**/*.go"
  - "**/go.mod"
  - ".golangci.yml"
---

# Go

- Lint with `make go-lint-changed` (diff vs origin/main) or `make go-lint`: the
  pinned golangci-lint under go.mod's toolchain (`go-lint` queues through `haven slot run`).
  A raw `golangci-lint run` breaks on machines with a newer Go.
- Lint catches what build, test and gofmt don't: `misspell` enforces US spelling
  in Go (`behaviour` fails), `nolintlint`, `testifylint` (`--fix` handles the
  first two).
- Before rewriting `assert.Equal(t, 1.0, …)` to `InEpsilon` for `float-compare`,
  check whether the expected value can be zero: `InEpsilon(0.0, 0.0)` is always
  false. `.golangci.yml` scopes the exclusions where `Equal` is correct.
