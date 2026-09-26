# Changelog

## [1.1.0](https://github.com/langwatch/langwatch/compare/sdks/go/v1.0.0...sdks/go/v1.1.0) (2026-09-26)


### Features

* **instant-evals:** meter judgements on the gateway spend spine, a Stripe meter and a 1 USD free budget ([#8220](https://github.com/langwatch/langwatch/issues/8220)) ([e5a2252](https://github.com/langwatch/langwatch/commit/e5a22526eca51e242d9018e3ac24928fe9250131))
* **instant-evals:** the CLI that waits for the answer, the target shorthand and estimate before spend ([#8216](https://github.com/langwatch/langwatch/issues/8216)) ([c01b277](https://github.com/langwatch/langwatch/commit/c01b277a7631308a2d45dfa5ac97dd3a46ef58ff))
* **instant-evals:** the Instant Eval run, a judgment job over an LWQL statement with progress and persisted judgments ([#8208](https://github.com/langwatch/langwatch/issues/8208)) ([e337419](https://github.com/langwatch/langwatch/commit/e33741926479c94f6d0b6d2b80d76e886dc1e109))
* **lwql:** app-side extraction functions as identity UDFs with a hydration stage ([#8196](https://github.com/langwatch/langwatch/issues/8196)) ([ad1bc9e](https://github.com/langwatch/langwatch/commit/ad1bc9eddf8f1c30e79b213cbd7fdbcb4563f990))
* **lwql:** eval functions judged by the classifier interface (Instant Evals) ([#8201](https://github.com/langwatch/langwatch/issues/8201)) ([1eb6dfe](https://github.com/langwatch/langwatch/commit/1eb6dfe76206df168df94c443319760dc4bc4591))
* **onboarding:** a Langy-guided onboarding after sign-up, behind a flag for the A/B test ([#7920](https://github.com/langwatch/langwatch/issues/7920)) ([5f5b591](https://github.com/langwatch/langwatch/commit/5f5b591c2dd55beb5991064b7ce55dc6509b0255))
* **query:** one reference door for LWQL and trace filters, filter and facets on the traces API, langwatch query CLI, MCP run_query ([#8198](https://github.com/langwatch/langwatch/issues/8198)) ([0b5f4d0](https://github.com/langwatch/langwatch/commit/0b5f4d0add6cdc6c6483264f1ff4847f44410eb5))
* **query:** self-describing LangWatchQL door + whoami --json ([#8085](https://github.com/langwatch/langwatch/issues/8085)) ([#8113](https://github.com/langwatch/langwatch/issues/8113)) ([5b17bde](https://github.com/langwatch/langwatch/commit/5b17bde8e2497714d489504d13d8306393be429c))
* **self-hosting:** connected self-hosted, hosted services metered against the license ([#8232](https://github.com/langwatch/langwatch/issues/8232)) ([8cfb4c3](https://github.com/langwatch/langwatch/commit/8cfb4c379c2f7b95486d9b0e02017f81f1ad14d9))
* webinar learnings, connected agent scope, scenario names, search hints, deep links, judge and Langy fixes ([#8236](https://github.com/langwatch/langwatch/issues/8236)) ([2054720](https://github.com/langwatch/langwatch/commit/2054720f391a2fcec60b86870a98d87345ccf6ee))


### Bug Fixes

* **gateway:** publish image token quantities on the spend read surfaces ([#8104](https://github.com/langwatch/langwatch/issues/8104)) ([926364b](https://github.com/langwatch/langwatch/commit/926364bcd60001440881b888236f51c80ff8abb8))
* **instant-evals:** end-to-end dogfood on main, five fixes in how numbers and words reach the caller ([#8233](https://github.com/langwatch/langwatch/issues/8233)) ([c5c0030](https://github.com/langwatch/langwatch/commit/c5c00301250d6c8354b126732c56e80e3dda9514))
* **instant-evals:** review sweep over the ten Instant Evals PRs ([#8230](https://github.com/langwatch/langwatch/issues/8230)) ([1126498](https://github.com/langwatch/langwatch/commit/11264989ee5efa081e282bc0fd12f0917d3f2c92))


### Miscellaneous

* **deps:** bump google.golang.org/grpc to v1.83.1 for GO-2026-6348 ([#8197](https://github.com/langwatch/langwatch/issues/8197)) ([090df20](https://github.com/langwatch/langwatch/commit/090df20c84f56633ef5d496659cdaad8ad4d672b))

## [1.0.0](https://github.com/langwatch/langwatch/compare/sdks/go/v0.3.0...sdks/go/v1.0.0) (2026-09-09)


### ⚠ BREAKING CHANGES

* **sdk-go:** five Annotation fields are now values rather than pointers, because the schema marks them required — Id, CreatedAt, UpdatedAt, ProjectId and TraceId. Callers that dereference them (`*a.Id`) no longer compile; read the field directly. The remaining nullable fields — Comment, Email, IsThumbsUp, UserId — are unchanged and stay pointers.

### Features

* **agents:** connected agents, a decorated function is a simulation target ([#7655](https://github.com/langwatch/langwatch/issues/7655)) ([56922c0](https://github.com/langwatch/langwatch/commit/56922c0ee429bd5a38717960c09ede0d1905c0c3))


### Bug Fixes

* **sdk-go:** decode the annotations envelope and regenerate the REST client ([#7989](https://github.com/langwatch/langwatch/issues/7989)) ([8d0d350](https://github.com/langwatch/langwatch/commit/8d0d3503c0f755133e805e0fc150a65b0ba8b44c))
* **sdk-go:** decode the annotations envelope, and regenerate the REST client ([8d0d350](https://github.com/langwatch/langwatch/commit/8d0d3503c0f755133e805e0fc150a65b0ba8b44c))


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
