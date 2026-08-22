# Changelog

## [1.0.0](https://github.com/langwatch/langwatch/compare/sdks/go/v0.3.0...sdks/go/v1.0.0) (2026-08-22)


### ⚠ BREAKING CHANGES

* **sdk-go:** the provider middlewares now capture input and output content by default (langwatch.DataCaptureAll), and the opt-in WithCaptureInput() / WithCaptureOutput() options are removed. An existing user who upgrades without passing WithDataCapture will begin exporting full prompts and completions, which routinely contain end-user PII. Opt out with WithDataCapture(langwatch.DataCaptureNone).

### Features

* **sdk-go:** native instrumentations, REST client, and gen_ai-first telemetry ([#4998](https://github.com/langwatch/langwatch/issues/4998)) ([893de7f](https://github.com/langwatch/langwatch/commit/893de7f740d56517ab835ece936b609bf6c81a11))


### Bug Fixes

* **traces:** reject pageOffset, and pin the updated-axis scroll to a snapshot ([#6812](https://github.com/langwatch/langwatch/issues/6812)) ([e490008](https://github.com/langwatch/langwatch/commit/e49000891dbd58fe0e033230dfc83c380e1b1615))


### Miscellaneous

* **deps:** bump the go_modules group across 12 directories with 3 updates ([#6830](https://github.com/langwatch/langwatch/issues/6830)) ([33287c4](https://github.com/langwatch/langwatch/commit/33287c44b91d07fb177eababc40ec5d6bae7debf))


### Code Refactoring

* **event-sourcing:** retire the reactor vocabulary — post-event work is subscribers and process managers (ADR-098) ([#6956](https://github.com/langwatch/langwatch/issues/6956)) ([8609798](https://github.com/langwatch/langwatch/commit/8609798ba36387596a62f8c513fd76660bd500dc))

## [0.3.0](https://github.com/langwatch/langwatch/compare/sdk-go@v0.2.0...sdk-go@v0.3.0) (2026-05-13)


### Features

* **ai-gateway:** ship v1 GA — virtual keys, budgets, guardrails, Go data plane ([#3327](https://github.com/langwatch/langwatch/issues/3327)) ([bd6ce5b](https://github.com/langwatch/langwatch/commit/bd6ce5b09492d31471ce2120401dd97751348821))
* **auth:** fine-grained personal access tokens ([#3212](https://github.com/langwatch/langwatch/issues/3212)) ([#3213](https://github.com/langwatch/langwatch/issues/3213)) ([bb7a6ee](https://github.com/langwatch/langwatch/commit/bb7a6ee422e6442dafaafa0848cce1869f980d16))


### Bug Fixes

* **deps:** upgrade go.opentelemetry.io/otel to v1.41.0 in sdk-go ([#3671](https://github.com/langwatch/langwatch/issues/3671)) ([9256833](https://github.com/langwatch/langwatch/commit/9256833425d76a7620465035b961fe3b26817f5e))
* **deps:** upgrade go.opentelemetry.io/otel to v1.41.0 in sdk-go (Dependabot [#961](https://github.com/langwatch/langwatch/issues/961), [#962](https://github.com/langwatch/langwatch/issues/962), [#963](https://github.com/langwatch/langwatch/issues/963)) ([9256833](https://github.com/langwatch/langwatch/commit/9256833425d76a7620465035b961fe3b26817f5e))
* **release:** path-routed Release-As shadows for 6 polluted components ([#3627](https://github.com/langwatch/langwatch/issues/3627)) ([b39d59e](https://github.com/langwatch/langwatch/commit/b39d59e87ed6d87224d580271175650c1d4159a7))
* **release:** scope Release-As to langwatch, restore other components ([#3618](https://github.com/langwatch/langwatch/issues/3618)) ([e259e79](https://github.com/langwatch/langwatch/commit/e259e796b50e4d060e5c7f42cad1927f1da8a83d))


### Miscellaneous

* **deps:** bump the go_modules group across 3 directories with 1 update ([#2467](https://github.com/langwatch/langwatch/issues/2467)) ([12d98d9](https://github.com/langwatch/langwatch/commit/12d98d9802e7bcd2d45a4f7934041118813a0de2))
* **deps:** bump the go_modules group across 4 directories with 3 updates ([#3761](https://github.com/langwatch/langwatch/issues/3761)) ([92af646](https://github.com/langwatch/langwatch/commit/92af646f459c935eab93e32513ac5930e5ef75f3))
* **go-sdk:** update go version to 1.25 in go mod ([#3764](https://github.com/langwatch/langwatch/issues/3764)) ([ac141fd](https://github.com/langwatch/langwatch/commit/ac141fd1c87738ff410288d62938dce5ede9736a))
* release as 3.2.1 ([ca9d7a9](https://github.com/langwatch/langwatch/commit/ca9d7a9231a7b3d9d8cf9a28a48fa494b1daeb4b))
* release as 3.2.1 (override release-please from 3.3.0) ([#3615](https://github.com/langwatch/langwatch/issues/3615)) ([ca9d7a9](https://github.com/langwatch/langwatch/commit/ca9d7a9231a7b3d9d8cf9a28a48fa494b1daeb4b))
* scope Release-As to langwatch, restore other components ([e259e79](https://github.com/langwatch/langwatch/commit/e259e796b50e4d060e5c7f42cad1927f1da8a83d))
* **sdk-go:** single-footer shadow Release-As 0.3.0 ([24f1889](https://github.com/langwatch/langwatch/commit/24f1889395df2bc9828e948a1a5724db940df87f))
