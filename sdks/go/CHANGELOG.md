# Changelog

## [1.1.0](https://github.com/langwatch/langwatch/compare/sdks/go/v1.0.0...sdks/go/v1.1.0) (2026-11-28)


### Features

* **braids:** show one project's matching spans in another project's traces ([#8946](https://github.com/langwatch/langwatch/issues/8946)) ([707db81](https://github.com/langwatch/langwatch/commit/707db81837e4d3a8205177469ffa231c19aceaa7))
* **dataset:** create a dataset with its rows in one call and upsert rows by a key column ([#9502](https://github.com/langwatch/langwatch/issues/9502)) ([0c843e2](https://github.com/langwatch/langwatch/commit/0c843e262e0768eb393611a3d4ba52d499925dd6))
* **experiments:** opt-in CI gate on evaluator failures; TS run() sends every input ([#9501](https://github.com/langwatch/langwatch/issues/9501)) ([eff2dac](https://github.com/langwatch/langwatch/commit/eff2dac43c18163cd5fac4f3cf850a55d9587d8c))
* **experiments:** show the agent version a label resolved to and the concurrency each run used ([#9449](https://github.com/langwatch/langwatch/issues/9449)) ([cbabd19](https://github.com/langwatch/langwatch/commit/cbabd1909c3a20e3cd8ad25c8817294d3d990f9f))
* **governance:** agent kill switch to stop agents on Databricks, Bedrock and the gateway, with approval and restore ([#9628](https://github.com/langwatch/langwatch/issues/9628)) ([857cc0d](https://github.com/langwatch/langwatch/commit/857cc0dc254c2cc7e1a1bd0096e753086a53648c))
* **governance:** agent registry with ARD v0.91 view, change feed and webhooks ([#9559](https://github.com/langwatch/langwatch/issues/9559)) ([7734ea6](https://github.com/langwatch/langwatch/commit/7734ea6bf5375a0dea12550edd00727a97772e9c))
* **governance:** discover agents on AWS, Google Cloud and ARD registries with shadow and dormant posture ([#9635](https://github.com/langwatch/langwatch/issues/9635)) ([46094f6](https://github.com/langwatch/langwatch/commit/46094f64f06b17f5de3b475af769140260e3a09c))
* **governance:** export, push and ingest OCSF 1.9 events for SIEMs ([#9624](https://github.com/langwatch/langwatch/issues/9624)) ([955477f](https://github.com/langwatch/langwatch/commit/955477f1936c3600b3d0880b2bf8f75b91a3a83f))
* **governance:** ingest OCSF AI events from AWS Security Lake ([#9638](https://github.com/langwatch/langwatch/issues/9638)) ([0db90c2](https://github.com/langwatch/langwatch/commit/0db90c242a639ef1adaf89148e816950a430a5c8))
* **langy:** measured changes, CI as the lab, traces always found, and a judge that reads long traces ([#9536](https://github.com/langwatch/langwatch/issues/9536)) ([a697ebd](https://github.com/langwatch/langwatch/commit/a697ebdf2403dc0aad86e3240fa7e00620d2395d))
* **organization:** seat requests over the limit, IdP refusal screens and a Billing role ([#9391](https://github.com/langwatch/langwatch/issues/9391)) ([0805d4e](https://github.com/langwatch/langwatch/commit/0805d4ee7d7ca66f10740a417176c7261c9c3e38))
* **scenario:** red team scenario kind, suite templates and the OWASP LLM Top 10 2025 pack (phase 1) ([#9640](https://github.com/langwatch/langwatch/issues/9640)) ([52abff0](https://github.com/langwatch/langwatch/commit/52abff019b506f987e3acd481a8585fff7909c4e))
* settings and docs polish, typed API playground, scoped docs playground sessions ([#9568](https://github.com/langwatch/langwatch/issues/9568)) ([a9f6428](https://github.com/langwatch/langwatch/commit/a9f6428693244ac519c67dd6b8ab86272e794b30))
* **staff-access:** copy an organization's projects into another organization ([#9538](https://github.com/langwatch/langwatch/issues/9538)) ([7abf0c5](https://github.com/langwatch/langwatch/commit/7abf0c5335e079eec12250f52aca603df516fb25))
* **staff-access:** passkey-approved one-hour agent access for operators ([#9267](https://github.com/langwatch/langwatch/issues/9267)) ([26bb2bf](https://github.com/langwatch/langwatch/commit/26bb2bffbd7b03f91b7e4205d058aba307317a02))


### Bug Fixes

* **agents,experiment:** agent edits refresh without reload, plus experiment workbench fixes ([#9290](https://github.com/langwatch/langwatch/issues/9290)) ([c4e344c](https://github.com/langwatch/langwatch/commit/c4e344ce7ffb073ee7e0933322340d60288e2025))
* **billing:** let every organization member start a paid subscription ([#9370](https://github.com/langwatch/langwatch/issues/9370)) ([56f6a10](https://github.com/langwatch/langwatch/commit/56f6a106451981e4d36dbbe831a33d37af034c1a))
* bound includeSpans trace search pages, and a round of error hygiene ([#8979](https://github.com/langwatch/langwatch/issues/8979)) ([ce120ab](https://github.com/langwatch/langwatch/commit/ce120ab2cedf7aa1db42655422145ffad1b303c3))
* **dashboards:** widgets and graphs created without a size land readable; /api/graphs takes the grid's bounds ([#9737](https://github.com/langwatch/langwatch/issues/9737)) ([88d08a7](https://github.com/langwatch/langwatch/commit/88d08a739420c0d1c47f279d1087746f7fb3dddb))
* **evaluator:** create custom code and workflow evaluators through the public API ([#9504](https://github.com/langwatch/langwatch/issues/9504)) ([2e36264](https://github.com/langwatch/langwatch/commit/2e36264f098b5cfdaf15f732c85ccf00b444233a))
* **gateway:** a virtual key config update keeps the sections it leaves out ([#9779](https://github.com/langwatch/langwatch/issues/9779)) ([5ece2f7](https://github.com/langwatch/langwatch/commit/5ece2f746b19056f36ed4572bd9a86d887751bdb))
* **gateway:** settle the A2A proxy review follow-ups ([#9824](https://github.com/langwatch/langwatch/issues/9824)) ([5714ee1](https://github.com/langwatch/langwatch/commit/5714ee1d46c4768290d8bb1f233542f22579dfdd))


### Miscellaneous

* **main:** release langwatch 3.31.0 ([#10004](https://github.com/langwatch/langwatch/issues/10004)) ([1edc0e5](https://github.com/langwatch/langwatch/commit/1edc0e59ff48ffe7704527abe0d741d21a45604c))

## [1.0.0](https://github.com/langwatch/langwatch/compare/sdks/go/v0.3.0...sdks/go/v1.0.0) (2026-09-09)

### ⚠ BREAKING CHANGES

- **sdk-go:** five Annotation fields are now values rather than pointers, because the schema marks them required — Id, CreatedAt, UpdatedAt, ProjectId and TraceId. Callers that dereference them (`*a.Id`) no longer compile; read the field directly. The remaining nullable fields — Comment, Email, IsThumbsUp, UserId — are unchanged and stay pointers.

### Features

- **agents:** connected agents, a decorated function is a simulation target ([#7655](https://github.com/langwatch/langwatch/issues/7655)) ([56922c0](https://github.com/langwatch/langwatch/commit/56922c0ee429bd5a38717960c09ede0d1905c0c3))

### Bug Fixes

- **sdk-go:** decode the annotations envelope and regenerate the REST client ([#7989](https://github.com/langwatch/langwatch/issues/7989)) ([8d0d350](https://github.com/langwatch/langwatch/commit/8d0d3503c0f755133e805e0fc150a65b0ba8b44c))

### Code Refactoring

- **event-sourcing:** retire the reactor vocabulary — post-event work is subscribers and process managers (ADR-098) ([#6956](https://github.com/langwatch/langwatch/issues/6956)) ([8609798](https://github.com/langwatch/langwatch/commit/8609798ba36387596a62f8c513fd76660bd500dc))

## [0.3.0](https://github.com/langwatch/langwatch/compare/sdk-go@v0.2.0...sdk-go@v0.3.0) (2026-05-13)

### Features

- **ai-gateway:** ship v1 GA — virtual keys, budgets, guardrails, Go data plane ([#3327](https://github.com/langwatch/langwatch/issues/3327)) ([bd6ce5b](https://github.com/langwatch/langwatch/commit/bd6ce5b09492d31471ce2120401dd97751348821))
- **auth:** fine-grained personal access tokens ([#3212](https://github.com/langwatch/langwatch/issues/3212)) ([#3213](https://github.com/langwatch/langwatch/issues/3213)) ([bb7a6ee](https://github.com/langwatch/langwatch/commit/bb7a6ee422e6442dafaafa0848cce1869f980d16))

### Bug Fixes

- **deps:** upgrade go.opentelemetry.io/otel to v1.41.0 in sdk-go ([#3671](https://github.com/langwatch/langwatch/issues/3671)) ([9256833](https://github.com/langwatch/langwatch/commit/9256833425d76a7620465035b961fe3b26817f5e))
- **release:** path-routed Release-As shadows for 6 polluted components ([#3627](https://github.com/langwatch/langwatch/issues/3627)) ([b39d59e](https://github.com/langwatch/langwatch/commit/b39d59e87ed6d87224d580271175650c1d4159a7))
- **release:** scope Release-As to langwatch, restore other components ([#3618](https://github.com/langwatch/langwatch/issues/3618)) ([e259e79](https://github.com/langwatch/langwatch/commit/e259e796b50e4d060e5c7f42cad1927f1da8a83d))

### Miscellaneous

- **deps:** bump the go_modules group across 3 directories with 1 update ([#2467](https://github.com/langwatch/langwatch/issues/2467)) ([12d98d9](https://github.com/langwatch/langwatch/commit/12d98d9802e7bcd2d45a4f7934041118813a0de2))
- **deps:** bump the go_modules group across 4 directories with 3 updates ([#3761](https://github.com/langwatch/langwatch/issues/3761)) ([92af646](https://github.com/langwatch/langwatch/commit/92af646f459c935eab93e32513ac5930e5ef75f3))
- **go-sdk:** update go version to 1.25 in go mod ([#3764](https://github.com/langwatch/langwatch/issues/3764)) ([ac141fd](https://github.com/langwatch/langwatch/commit/ac141fd1c87738ff410288d62938dce5ede9736a))
- release as 3.2.1 (override release-please from 3.3.0) ([#3615](https://github.com/langwatch/langwatch/issues/3615)) ([ca9d7a9](https://github.com/langwatch/langwatch/commit/ca9d7a9231a7b3d9d8cf9a28a48fa494b1daeb4b))
- **sdk-go:** single-footer shadow Release-As 0.3.0 ([24f1889](https://github.com/langwatch/langwatch/commit/24f1889395df2bc9828e948a1a5724db940df87f))
