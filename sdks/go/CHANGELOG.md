# Changelog

## [2.0.0](https://github.com/langwatch/langwatch/compare/sdks/go/v1.0.0...sdks/go/v2.0.0) (2026-11-14)


### ⚠ BREAKING CHANGES

* **sdk:** client.dashboards and langwatch.dashboards now address the new Dashboards API, not the old Reports; use client.analyticsReports / langwatch.analytics_reports for those. MCP Reports tools are renamed platform_*_analytics_report(s).

### Features

* agent and evaluator versioning with deploy labels, plus experiment and dependency fixes ([#9124](https://github.com/langwatch/langwatch/issues/9124)) ([ec774cb](https://github.com/langwatch/langwatch/commit/ec774cb12756a472d7260f6ed5e2292e324906cd))
* **braids:** show one project's matching spans in another project's traces ([#8946](https://github.com/langwatch/langwatch/issues/8946)) ([707db81](https://github.com/langwatch/langwatch/commit/707db81837e4d3a8205177469ffa231c19aceaa7))
* **coding-agent:** capture Grok CLI sessions through its native OpenTelemetry ([#9224](https://github.com/langwatch/langwatch/issues/9224)) ([34c0f70](https://github.com/langwatch/langwatch/commit/34c0f700c4ff679717de20ad9bd15647631b8cec))
* **coding-agent:** copilot CLI and VS Code sessions become rows ([#8884](https://github.com/langwatch/langwatch/issues/8884)) ([e5c5e8c](https://github.com/langwatch/langwatch/commit/e5c5e8c3eb372ac02eed8ad7e5bd1810fc3c3be1))
* **coding-agent:** track pi as a natively instrumented coding agent ([#9203](https://github.com/langwatch/langwatch/issues/9203)) ([52eaa9e](https://github.com/langwatch/langwatch/commit/52eaa9e8f38533d84dfdde9896ac0edcd5cffb7a))
* **dashboard:** add REST create and delete for Dashboards boards ([#8896](https://github.com/langwatch/langwatch/issues/8896)) ([fbc1469](https://github.com/langwatch/langwatch/commit/fbc1469027d6ef59c920243f63e2ebaf2264bcf8))
* **dashboard:** move dashboards v2 onto its own tables ([#8707](https://github.com/langwatch/langwatch/issues/8707)) ([7f1f527](https://github.com/langwatch/langwatch/commit/7f1f527f85363fe97cdc93d300b7c469de4463eb))
* **dashboards:** a per-dashboard Langy traces setting ([#9099](https://github.com/langwatch/langwatch/issues/9099)) ([821b467](https://github.com/langwatch/langwatch/commit/821b467e8a628e599951b42d3c871f0db454efd8))
* **dashboards:** per-widget "Langy traces" setting in the query editor ([#9137](https://github.com/langwatch/langwatch/issues/9137)) ([5e82c1e](https://github.com/langwatch/langwatch/commit/5e82c1ebc1d2dbfda817cf175f3aba62e485a0d8))
* **dashboards:** widget queries take sources and projects as params ([#9171](https://github.com/langwatch/langwatch/issues/9171)) ([af5a9c3](https://github.com/langwatch/langwatch/commit/af5a9c342951371a1cf547188cff78f9cd50bcc1))
* **dataset:** create a dataset with its rows in one call and upsert rows by a key column ([#9502](https://github.com/langwatch/langwatch/issues/9502)) ([0c843e2](https://github.com/langwatch/langwatch/commit/0c843e262e0768eb393611a3d4ba52d499925dd6))
* **dataset:** dataset version history with autosave, compare, restore, retention and run pinning ([#9121](https://github.com/langwatch/langwatch/issues/9121)) ([f50c6f0](https://github.com/langwatch/langwatch/commit/f50c6f0c999e9e1cadf7173db0e87b9d3f1108de))
* **docs:** add a lightweight static docs app ([#8563](https://github.com/langwatch/langwatch/issues/8563)) ([395ed9c](https://github.com/langwatch/langwatch/commit/395ed9c2ce9de4f25497a3b90092a1e647018ac6))
* **experiment:** accept a per-run concurrency on the experiment run API ([#9023](https://github.com/langwatch/langwatch/issues/9023)) ([640d0f6](https://github.com/langwatch/langwatch/commit/640d0f6e21afd19e46eaed9312d4c04c121b9a4b))
* **experiments:** show the agent version a label resolved to and the concurrency each run used ([#9449](https://github.com/langwatch/langwatch/issues/9449)) ([cbabd19](https://github.com/langwatch/langwatch/commit/cbabd1909c3a20e3cd8ad25c8817294d3d990f9f))
* **governance:** agent registry with ARD v0.91 view, change feed and webhooks ([#9559](https://github.com/langwatch/langwatch/issues/9559)) ([7734ea6](https://github.com/langwatch/langwatch/commit/7734ea6bf5375a0dea12550edd00727a97772e9c))
* **model-provider:** instant evals decision model column with own-key decision models ([#8935](https://github.com/langwatch/langwatch/issues/8935)) ([9b022a5](https://github.com/langwatch/langwatch/commit/9b022a535f304bee38bca86530cc901b03731baa))
* **monitor:** pause a monitor whose evaluations mostly fail ([#9040](https://github.com/langwatch/langwatch/issues/9040)) ([fcbd9ed](https://github.com/langwatch/langwatch/commit/fcbd9edabbfa2fd9b3a4c142c678298a846e184d))
* **organization:** seat requests over the limit, IdP refusal screens and a Billing role ([#9391](https://github.com/langwatch/langwatch/issues/9391)) ([0805d4e](https://github.com/langwatch/langwatch/commit/0805d4ee7d7ca66f10740a417176c7261c9c3e38))
* **scenarios:** setup and teardown hooks for connected agents ([#8765](https://github.com/langwatch/langwatch/issues/8765)) ([b0949cd](https://github.com/langwatch/langwatch/commit/b0949cdd929d35f030ddeb2fc1c16b1f33328c0f))
* **sdk:** one product per dashboards path; dashboards means the new product everywhere ([#9089](https://github.com/langwatch/langwatch/issues/9089)) ([552534d](https://github.com/langwatch/langwatch/commit/552534d24487441ac5395d91c1af69ed072a0c00))
* **sdks:** send traces as gzipped OTLP/protobuf by default in every SDK ([#8592](https://github.com/langwatch/langwatch/issues/8592)) ([206c830](https://github.com/langwatch/langwatch/commit/206c830dc5653660348004fb10a267cc9d13e7b2))
* **server:** npx downloads a prebuilt app; evaluations retry while the evaluator is down ([#8845](https://github.com/langwatch/langwatch/issues/8845)) ([6e44487](https://github.com/langwatch/langwatch/commit/6e444878b00756e6d31e3d6cb36611b80920234c))


### Bug Fixes

* **agents,experiment:** agent edits refresh without reload, plus experiment workbench fixes ([#9290](https://github.com/langwatch/langwatch/issues/9290)) ([c4e344c](https://github.com/langwatch/langwatch/commit/c4e344ce7ffb073ee7e0933322340d60288e2025))
* **billing:** let every organization member start a paid subscription ([#9370](https://github.com/langwatch/langwatch/issues/9370)) ([56f6a10](https://github.com/langwatch/langwatch/commit/56f6a106451981e4d36dbbe831a33d37af034c1a))
* **evaluator:** create custom code and workflow evaluators through the public API ([#9504](https://github.com/langwatch/langwatch/issues/9504)) ([2e36264](https://github.com/langwatch/langwatch/commit/2e36264f098b5cfdaf15f732c85ccf00b444233a))
* **langevals:** judges reach a verdict on gpt-6 reasoning models ([#9102](https://github.com/langwatch/langwatch/issues/9102)) ([d7b6238](https://github.com/langwatch/langwatch/commit/d7b623874e55e0b6af4d81ce9671114d54dfb2cc))
* **security:** close all 52 Go alerts (grpc 1.83.2 in 16 modules, OTel-Go 1.45.0 in the SDK) ([#7931](https://github.com/langwatch/langwatch/issues/7931)) ([691f480](https://github.com/langwatch/langwatch/commit/691f4807bb06db2213898e640b0e4075168062bc))
* **trace:** a span's own attributes never break its read on a request-param name ([#9179](https://github.com/langwatch/langwatch/issues/9179)) ([d8adba2](https://github.com/langwatch/langwatch/commit/d8adba263b07692e61b5621527d5ade34d019894))

## [1.0.0](https://github.com/langwatch/langwatch/compare/sdks/go/v0.3.0...sdks/go/v1.0.0) (2026-09-09)

### ⚠ BREAKING CHANGES

- **sdk-go:** five Annotation fields are now values rather than pointers, because the schema marks them required — Id, CreatedAt, UpdatedAt, ProjectId and TraceId. Callers that dereference them (`*a.Id`) no longer compile; read the field directly. The remaining nullable fields — Comment, Email, IsThumbsUp, UserId — are unchanged and stay pointers.

### Features

- **agents:** connected agents, a decorated function is a simulation target ([#7655](https://github.com/langwatch/langwatch/issues/7655)) ([56922c0](https://github.com/langwatch/langwatch/commit/56922c0ee429bd5a38717960c09ede0d1905c0c3))

### Bug Fixes

- **sdk-go:** decode the annotations envelope and regenerate the REST client ([#7989](https://github.com/langwatch/langwatch/issues/7989)) ([8d0d350](https://github.com/langwatch/langwatch/commit/8d0d3503c0f755133e805e0fc150a65b0ba8b44c))
- **sdk-go:** decode the annotations envelope, and regenerate the REST client ([8d0d350](https://github.com/langwatch/langwatch/commit/8d0d3503c0f755133e805e0fc150a65b0ba8b44c))

### Code Refactoring

- **event-sourcing:** retire the reactor vocabulary — post-event work is subscribers and process managers (ADR-098) ([#6956](https://github.com/langwatch/langwatch/issues/6956)) ([8609798](https://github.com/langwatch/langwatch/commit/8609798ba36387596a62f8c513fd76660bd500dc))

## [0.3.0](https://github.com/langwatch/langwatch/compare/sdk-go@v0.2.0...sdk-go@v0.3.0) (2026-05-13)

### Features

- **ai-gateway:** ship v1 GA — virtual keys, budgets, guardrails, Go data plane ([#3327](https://github.com/langwatch/langwatch/issues/3327)) ([bd6ce5b](https://github.com/langwatch/langwatch/commit/bd6ce5b09492d31471ce2120401dd97751348821))
- **auth:** fine-grained personal access tokens ([#3212](https://github.com/langwatch/langwatch/issues/3212)) ([#3213](https://github.com/langwatch/langwatch/issues/3213)) ([bb7a6ee](https://github.com/langwatch/langwatch/commit/bb7a6ee422e6442dafaafa0848cce1869f980d16))

### Bug Fixes

- **deps:** upgrade go.opentelemetry.io/otel to v1.41.0 in sdk-go ([#3671](https://github.com/langwatch/langwatch/issues/3671)) ([9256833](https://github.com/langwatch/langwatch/commit/9256833425d76a7620465035b961fe3b26817f5e))
- **deps:** upgrade go.opentelemetry.io/otel to v1.41.0 in sdk-go (Dependabot [#961](https://github.com/langwatch/langwatch/issues/961), [#962](https://github.com/langwatch/langwatch/issues/962), [#963](https://github.com/langwatch/langwatch/issues/963)) ([9256833](https://github.com/langwatch/langwatch/commit/9256833425d76a7620465035b961fe3b26817f5e))
- **release:** path-routed Release-As shadows for 6 polluted components ([#3627](https://github.com/langwatch/langwatch/issues/3627)) ([b39d59e](https://github.com/langwatch/langwatch/commit/b39d59e87ed6d87224d580271175650c1d4159a7))
- **release:** scope Release-As to langwatch, restore other components ([#3618](https://github.com/langwatch/langwatch/issues/3618)) ([e259e79](https://github.com/langwatch/langwatch/commit/e259e796b50e4d060e5c7f42cad1927f1da8a83d))

### Miscellaneous

- **deps:** bump the go_modules group across 3 directories with 1 update ([#2467](https://github.com/langwatch/langwatch/issues/2467)) ([12d98d9](https://github.com/langwatch/langwatch/commit/12d98d9802e7bcd2d45a4f7934041118813a0de2))
- **deps:** bump the go_modules group across 4 directories with 3 updates ([#3761](https://github.com/langwatch/langwatch/issues/3761)) ([92af646](https://github.com/langwatch/langwatch/commit/92af646f459c935eab93e32513ac5930e5ef75f3))
- **go-sdk:** update go version to 1.25 in go mod ([#3764](https://github.com/langwatch/langwatch/issues/3764)) ([ac141fd](https://github.com/langwatch/langwatch/commit/ac141fd1c87738ff410288d62938dce5ede9736a))
- release as 3.2.1 ([ca9d7a9](https://github.com/langwatch/langwatch/commit/ca9d7a9231a7b3d9d8cf9a28a48fa494b1daeb4b))
- release as 3.2.1 (override release-please from 3.3.0) ([#3615](https://github.com/langwatch/langwatch/issues/3615)) ([ca9d7a9](https://github.com/langwatch/langwatch/commit/ca9d7a9231a7b3d9d8cf9a28a48fa494b1daeb4b))
- scope Release-As to langwatch, restore other components ([e259e79](https://github.com/langwatch/langwatch/commit/e259e796b50e4d060e5c7f42cad1927f1da8a83d))
- **sdk-go:** single-footer shadow Release-As 0.3.0 ([24f1889](https://github.com/langwatch/langwatch/commit/24f1889395df2bc9828e948a1a5724db940df87f))
