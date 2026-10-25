# lingua-go (vendored, patched)

Upstream: [github.com/pemistahl/lingua-go](https://github.com/pemistahl/lingua-go) v1.4.0,
Copyright © 2021-present Peter M. Stahl, Apache License 2.0 (`LICENSE`).
`internal/decimal` is [github.com/shopspring/decimal](https://github.com/shopspring/decimal) v1.3.1,
MIT (`internal/decimal/LICENSE`), vendored unchanged so the root `go.mod` gains nothing.

Why it is vendored: nlpgo's `lingua/language_detection` must answer as langevals (Python lingua
2.1.1) does. Upstream decodes its models into Go maps (about 2 GB of heap) and tokenizes Indic
scripts and Hangul differently from lingua-rs. Decision: plan D16 in
`dev/docs/plans/langevals-go-replacement.md`.

## Changes from upstream

- **Models**: the embedded `language-models/` protobuf zips are gone. `cmd/genmodels` converts
  them at build time into `models.bin` (flat sorted fixed-width records, about 243 MB, gitignored)
  and `models.go` binary-searches it in place. `detector.go`'s loader returns that view instead
  of decoding into `map[string]float64`.
- **Loading**: `LoadModels` maps `models.bin` read-only at boot (`load.go`, `mmap_unix.go`); nlpgo
  passes `NLPGO_LINGUA_MODELS`, which the nlp image sets. Until it is loaded every lookup misses and
  `ModelsAvailable()` reports false. No build tag: every build compiles without the file.
  Generate with `make lingua-models` (or `go generate ./third_party/lingua-go`).
- **Tokenizer**: `letters` in `constant.go` is lingua-rs 1.7.2's regex (whole runs of Bengali,
  Devanagari, Gujarati, Gurmukhi, Hangul, Tamil, Telugu and Thai). Go's `\p{L}` drops Indic
  combining marks and upstream split Hangul per syllable, which changed answers.
- **Dependencies**: `golang.org/x/exp` replaced by the standard `maps` and `slices`;
  `github.com/shopspring/decimal` vendored as `internal/decimal`.
- **Dropped**: tests, `writer.go` (training-data writer), README, release notes, CI files,
  upstream's `go:generate stringer` lines (their output is vendored) and `go.mod`.
