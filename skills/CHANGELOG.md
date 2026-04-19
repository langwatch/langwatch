# Changelog

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
