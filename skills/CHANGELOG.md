# Changelog

## [0.5.0](https://github.com/langwatch/langwatch/compare/skills@v0.4.1...skills@v0.5.0) (2026-06-02)


### Features

* **api-keys:** scope-based permissions with fine-grained categories + docs ([#4117](https://github.com/langwatch/langwatch/issues/4117)) ([3dca0f6](https://github.com/langwatch/langwatch/commit/3dca0f685f8df8333d22117581510b0f6e13442d))
* **skills/scenarios:** voice agents section + dogfood coverage ([#4504](https://github.com/langwatch/langwatch/issues/4504)) ([50a990c](https://github.com/langwatch/langwatch/commit/50a990c5703b821174b76282ca9938add8eadadd))


### Bug Fixes

* **deps:** bump hono to &gt;=4.12.18 across the monorepo (closes 22 alerts) ([#4457](https://github.com/langwatch/langwatch/issues/4457)) ([3e062b5](https://github.com/langwatch/langwatch/commit/3e062b50b44730e3e9b320b186d63a1a4ff993b8))
* **deps:** bump hono to &gt;=4.12.18 and @hono/node-server to &gt;=1.19.13 across the monorepo ([3e062b5](https://github.com/langwatch/langwatch/commit/3e062b50b44730e3e9b320b186d63a1a4ff993b8))
* **deps:** bump protobufjs to &gt;=7.5.6 in skills and mastra example ([#4014](https://github.com/langwatch/langwatch/issues/4014)) ([bf4908c](https://github.com/langwatch/langwatch/commit/bf4908cc12dda98bf039be684265f36e9bda1742))
* **deps:** bump protobufjs to clear CVE-2026-41242 across JS workspaces ([#3612](https://github.com/langwatch/langwatch/issues/3612)) ([f2f2c37](https://github.com/langwatch/langwatch/commit/f2f2c37a4dc2011e7463752e952172b6225c2b6d))
* **deps:** bump uuid to &gt;=11.1.1 across the monorepo (closes 7 alerts) ([#4470](https://github.com/langwatch/langwatch/issues/4470)) ([f22706b](https://github.com/langwatch/langwatch/commit/f22706b523526875ecd639d54c1e392d27cbcfae))
* **deps:** bump vitest to &gt;=4.1.0 across the monorepo (closes 9 CRITICAL alerts) ([#4495](https://github.com/langwatch/langwatch/issues/4495)) ([6f90ef4](https://github.com/langwatch/langwatch/commit/6f90ef48ae5b9436742bbda5d4bef21ea904db82))
* **deps:** patch high-severity npm vulnerabilities (fast-xml-builder, fast-uri) ([#3928](https://github.com/langwatch/langwatch/issues/3928)) ([2eb205b](https://github.com/langwatch/langwatch/commit/2eb205ba86e1ebd4c7f078c8dba746dd9f50b919))
* **deps:** upgrade langsmith sdk security floors ([2e18927](https://github.com/langwatch/langwatch/commit/2e18927c0c1c1fdec24c2bba17e5f094e56a9deb))
* **deps:** upgrade LangSmith SDK security floors ([#4041](https://github.com/langwatch/langwatch/issues/4041)) ([2e18927](https://github.com/langwatch/langwatch/commit/2e18927c0c1c1fdec24c2bba17e5f094e56a9deb))
* **prompts:** lossless structured-output and parameter sync between platform and local yaml ([#4068](https://github.com/langwatch/langwatch/issues/4068)) ([c3c5941](https://github.com/langwatch/langwatch/commit/c3c59417c916e4aaaba453723cb9f527834efbb8))
* **release:** path-routed Release-As shadows for 6 polluted components ([#3627](https://github.com/langwatch/langwatch/issues/3627)) ([b39d59e](https://github.com/langwatch/langwatch/commit/b39d59e87ed6d87224d580271175650c1d4159a7))
* **release:** scope Release-As to langwatch, restore other components ([#3618](https://github.com/langwatch/langwatch/issues/3618)) ([e259e79](https://github.com/langwatch/langwatch/commit/e259e796b50e4d060e5c7f42cad1927f1da8a83d))


### Miscellaneous

* **deps:** bump liquidjs to &gt;=10.26.0 (RCE GHSA-gf2q-c269-pqgc) in typescript-sdk, skills, mcp-server ([#4340](https://github.com/langwatch/langwatch/issues/4340)) ([697e07e](https://github.com/langwatch/langwatch/commit/697e07e82241dc837afb414458e67f539d23fb54))
* **deps:** bump liquidjs to &gt;=10.26.0 in typescript-sdk, skills, mcp-server (GHSA-gf2q-c269-pqgc) ([697e07e](https://github.com/langwatch/langwatch/commit/697e07e82241dc837afb414458e67f539d23fb54))
* release as 3.2.1 ([ca9d7a9](https://github.com/langwatch/langwatch/commit/ca9d7a9231a7b3d9d8cf9a28a48fa494b1daeb4b))
* release as 3.2.1 (override release-please from 3.3.0) ([#3615](https://github.com/langwatch/langwatch/issues/3615)) ([ca9d7a9](https://github.com/langwatch/langwatch/commit/ca9d7a9231a7b3d9d8cf9a28a48fa494b1daeb4b))
* scope Release-As to langwatch, restore other components ([e259e79](https://github.com/langwatch/langwatch/commit/e259e796b50e4d060e5c7f42cad1927f1da8a83d))
* **security:** add dependency age gates ([#3523](https://github.com/langwatch/langwatch/issues/3523)) ([78f5b20](https://github.com/langwatch/langwatch/commit/78f5b2059228748d19fb4bf74118c9bee6c474f9))
* **skills:** single-footer shadow Release-As 0.5.0 ([475f598](https://github.com/langwatch/langwatch/commit/475f598fcd0a2b9175ae021335a56568a6995894))

## [0.4.1](https://github.com/langwatch/langwatch/compare/skills@v0.4.0...skills@v0.4.1) (2026-04-24)


### Bug Fixes

* **skills-publish:** stop sync.sh nuking target repo's .git ([#3425](https://github.com/langwatch/langwatch/issues/3425)) ([72fef44](https://github.com/langwatch/langwatch/commit/72fef447db36d2a820a315d2818df9d6ec381512))


### Code Refactoring

* **skills:** real MDX with imports + JSX, retire link-as-partial sleight of hand ([#3432](https://github.com/langwatch/langwatch/issues/3432)) ([3141eb8](https://github.com/langwatch/langwatch/commit/3141eb8569071151c9969efa1a12a30401fd7792))

## [0.4.0](https://github.com/langwatch/langwatch/compare/skills@v0.3.0...skills@v0.4.0) (2026-04-23)


### Features

* **skills:** make skills CLI-only and add `langwatch docs` / `scenario-docs` ([#3274](https://github.com/langwatch/langwatch/issues/3274)) ([b7aefef](https://github.com/langwatch/langwatch/commit/b7aefefb006560f3e8ba8f49128522f8caeb1a7b))


### Miscellaneous

* **deps:** bump the npm_and_yarn group across 4 directories with 6 updates ([#3401](https://github.com/langwatch/langwatch/issues/3401)) ([63d21c7](https://github.com/langwatch/langwatch/commit/63d21c734d47dc629db6d3228d39976acf8b06cf))
* **deps:** bump the npm_and_yarn group across 7 directories with 8 updates ([#3286](https://github.com/langwatch/langwatch/issues/3286)) ([6939c5c](https://github.com/langwatch/langwatch/commit/6939c5cce6112b132a82f0c3105e86aab6568f45))

## [0.3.0](https://github.com/langwatch/langwatch/compare/skills@v0.2.0...skills@v0.3.0) (2026-04-17)


### Features

* add dataset generation skill with scenario tests ([#3217](https://github.com/langwatch/langwatch/issues/3217)) ([71c4b35](https://github.com/langwatch/langwatch/commit/71c4b351d78647de54e8c68c455b76821adce1ba))
* add prompt tag support to MCP tools, docs, and skills ([#2934](https://github.com/langwatch/langwatch/issues/2934)) ([858e0d7](https://github.com/langwatch/langwatch/commit/858e0d7df3df8c70822e2155a73453bf1a6fd324))
* full CLI, API, and MCP coverage for all platform features ([#3168](https://github.com/langwatch/langwatch/issues/3168)) ([921b7b9](https://github.com/langwatch/langwatch/commit/921b7b92d3ccc038556fe2241a3a90302786631e))
* **mcp:** add dataset mcp tools ([#2926](https://github.com/langwatch/langwatch/issues/2926)) ([666710c](https://github.com/langwatch/langwatch/commit/666710cbb1052f9b7180378a7c24490e4a103b9f))


### Bug Fixes

* make dataset upload to platform the primary goal ([#3232](https://github.com/langwatch/langwatch/issues/3232)) ([43616b6](https://github.com/langwatch/langwatch/commit/43616b6eb3d9abdca76b7e6efb0755404d3f8abd))
* **onboarding:** prevent ENAMETOOLONG crash in Gemini CLI on prompt paste ([#3107](https://github.com/langwatch/langwatch/issues/3107)) ([df6a446](https://github.com/langwatch/langwatch/commit/df6a4461dd9040d5c30cf702f192941061ca462e))
* require tag-based fetch pattern in scenario assertion ([#3098](https://github.com/langwatch/langwatch/issues/3098)) ([b20d605](https://github.com/langwatch/langwatch/commit/b20d605c0b6a7478805a4ac6716b08e12c1d08fe)), closes [#2939](https://github.com/langwatch/langwatch/issues/2939)
* **skills:** update MCP config schema for Claude Code compatibility ([#2927](https://github.com/langwatch/langwatch/issues/2927)) ([f85cf4e](https://github.com/langwatch/langwatch/commit/f85cf4e8ad67c518c1cb0f2ba830a6ad8ed00acc))

## [0.2.0](https://github.com/langwatch/langwatch/compare/skills@v0.1.0...skills@v0.2.0) (2026-03-29)


### Features

* add skills publish pipeline to langwatch/skills repo ([#2415](https://github.com/langwatch/langwatch/issues/2415)) ([9b769fe](https://github.com/langwatch/langwatch/commit/9b769fe8b6e11a18434e967564697a26c48f8aa0))
* auto-regenerate docs prompts + llms.txt via git hooks + CI ([#2686](https://github.com/langwatch/langwatch/issues/2686)) ([9f78ffa](https://github.com/langwatch/langwatch/commit/9f78ffae2257c8a233b318957f06aa264f9ccac1))
* **skills:** agent skills-based onboarding with feature map and scenario tests ([#2377](https://github.com/langwatch/langwatch/issues/2377)) ([6f6abdb](https://github.com/langwatch/langwatch/commit/6f6abdb67b97fcb7c2958dbc193dcde37d4c82a8))


### Bug Fixes

* include version.txt in skills publish sync ([#2417](https://github.com/langwatch/langwatch/issues/2417)) ([1cd6606](https://github.com/langwatch/langwatch/commit/1cd66066a90984530059eef502d29359c14bf0ea))
* **sdk+skills:** widen peer deps, fix scenario config, strengthen skill tests ([#2485](https://github.com/langwatch/langwatch/issues/2485)) ([c77237c](https://github.com/langwatch/langwatch/commit/c77237c8f5690f4eafcc96ed3334e3c6d61a7249))
