# Changelog

## [0.7.0](https://github.com/langwatch/langwatch/compare/mcp-server@v0.6.1...mcp-server@v0.7.0) (2026-04-16)


### Features

* add mcp-server to langwatch pnpm workspace ([#3069](https://github.com/langwatch/langwatch/issues/3069)) ([73915d2](https://github.com/langwatch/langwatch/commit/73915d24fd47b8d6b5e33210fd3f73ac0f745e11))
* add prompt tag support to MCP tools, docs, and skills ([#2934](https://github.com/langwatch/langwatch/issues/2934)) ([858e0d7](https://github.com/langwatch/langwatch/commit/858e0d7df3df8c70822e2155a73453bf1a6fd324))
* full CLI, API, and MCP coverage for all platform features ([#3168](https://github.com/langwatch/langwatch/issues/3168)) ([921b7b9](https://github.com/langwatch/langwatch/commit/921b7b92d3ccc038556fe2241a3a90302786631e))
* **mcp-server:** oauth 2.0 + SSE client compatibility ([#2557](https://github.com/langwatch/langwatch/issues/2557)) ([7327579](https://github.com/langwatch/langwatch/commit/73275796aca80b90c4d78beb9033e33b0e4a8da9))
* **mcp:** add dataset mcp tools ([#2926](https://github.com/langwatch/langwatch/issues/2926)) ([666710c](https://github.com/langwatch/langwatch/commit/666710cbb1052f9b7180378a7c24490e4a103b9f))
* **mcp:** mount MCP HTTP server in-app with OAuth PKCE authorization ([#2847](https://github.com/langwatch/langwatch/issues/2847)) ([9d57dd8](https://github.com/langwatch/langwatch/commit/9d57dd877f80ba529d32879a387d4f4d0d0216b6))
* **skills:** agent skills-based onboarding with feature map and scenario tests ([#2377](https://github.com/langwatch/langwatch/issues/2377)) ([6f6abdb](https://github.com/langwatch/langwatch/commit/6f6abdb67b97fcb7c2958dbc193dcde37d4c82a8))


### Bug Fixes

* analytics groupBy returns empty in MCP tool and trigger alerts ([#3012](https://github.com/langwatch/langwatch/issues/3012)) ([634db38](https://github.com/langwatch/langwatch/commit/634db380de35132b6ed88ce04e3998a3229f90db))
* **mcp:** build config and create-mcp-server with tsup to fix dual-module bug ([640c2e4](https://github.com/langwatch/langwatch/commit/640c2e42024cc40b0b02c1abac4cf07f6881f497))
* **mcp:** build subexports with tsup to eliminate dual-module bug ([#2985](https://github.com/langwatch/langwatch/issues/2985)) ([640c2e4](https://github.com/langwatch/langwatch/commit/640c2e42024cc40b0b02c1abac4cf07f6881f497))
* **mcp:** resolve dual-module config bug causing "Config not initialized" in production ([fcf0e0b](https://github.com/langwatch/langwatch/commit/fcf0e0b0f85bfc6b10a26ac917fe2c3f0335771d))
* **mcp:** resolve dual-module config bug in production ([#2956](https://github.com/langwatch/langwatch/issues/2956)) ([fcf0e0b](https://github.com/langwatch/langwatch/commit/fcf0e0b0f85bfc6b10a26ac917fe2c3f0335771d))
* **mcp:** use globalThis for config singleton to fix CJS/ESM dual cache ([#3123](https://github.com/langwatch/langwatch/issues/3123)) ([a7ece22](https://github.com/langwatch/langwatch/commit/a7ece22144b67dcd5318d9abdd5d3ba66464bbb7))

## [0.6.1](https://github.com/langwatch/langwatch/compare/mcp-server@v0.6.0...mcp-server@v0.6.1) (2026-03-13)


### Bug Fixes

* fix scenario relative path solving for docs ([315abfd](https://github.com/langwatch/langwatch/commit/315abfd4c9d21641f0c1845fcf29b6337673ce6d))

## [0.6.0](https://github.com/langwatch/langwatch/compare/mcp-server@v0.5.0...mcp-server@v0.6.0) (2026-03-13)


### Features

* add platform MCP tools for evaluators and model providers ([#1762](https://github.com/langwatch/langwatch/issues/1762)) ([6339001](https://github.com/langwatch/langwatch/commit/6339001ffae3c83f7c3ea0cdadf480f4ec47f3cc))
* prefix platform MCP tools with `platform_` and add disambiguation notes ([#1760](https://github.com/langwatch/langwatch/issues/1760)) ([91851ee](https://github.com/langwatch/langwatch/commit/91851ee28aff1b3b75d92ce46aec6ae5072ff625))


### Bug Fixes

* **deps:** pin transitive npm deps for Dependabot high-severity alerts ([#2220](https://github.com/langwatch/langwatch/issues/2220)) ([a179da1](https://github.com/langwatch/langwatch/commit/a179da1d55859b8c9a476a6443dbfaf6bf632af3))
* **mcp:** align prompt tool schemas with backend API ([#2326](https://github.com/langwatch/langwatch/issues/2326)) ([65279f3](https://github.com/langwatch/langwatch/commit/65279f38687bae5c7dc7a13db33dcb2f7d135397))
* **mcp:** resolve get_trace 404 and search_traces metadata filter bugs ([#2214](https://github.com/langwatch/langwatch/issues/2214)) ([a0362e6](https://github.com/langwatch/langwatch/commit/a0362e60aa54e7c6e5dac9f241b206f4f4cd0b5f))
* normalize defaultModel with provider prefix for litellm routing ([cc7798e](https://github.com/langwatch/langwatch/commit/cc7798ecb229654f371912e7863ca20364ceb7fa))


### Miscellaneous

* **deps:** batch safe JS dependency bumps (Tier 1a) ([#2169](https://github.com/langwatch/langwatch/issues/2169)) ([8b5b891](https://github.com/langwatch/langwatch/commit/8b5b8915941f19ca07019b330e276f01ae3bface))
* **deps:** bump mcp-server zod to v4 ([#1977](https://github.com/langwatch/langwatch/issues/1977)) ([eb89188](https://github.com/langwatch/langwatch/commit/eb891883eb47db01bfee4d184b1c9b19e3cc60d7))
* **deps:** bump Node.js dependencies - batch 2 ([#1947](https://github.com/langwatch/langwatch/issues/1947)) ([98d9f5c](https://github.com/langwatch/langwatch/commit/98d9f5cb53dc13051c500359def11b35762fd5e5))
* **deps:** bump safe npm dependencies (19 dependabot PRs) ([#1931](https://github.com/langwatch/langwatch/issues/1931)) ([4d7607e](https://github.com/langwatch/langwatch/commit/4d7607e5d467749e2e47fc3b0b2b58c212bc8721))
* **deps:** bump the npm_and_yarn group across 1 directory with 5 updates ([#1948](https://github.com/langwatch/langwatch/issues/1948)) ([9227fb4](https://github.com/langwatch/langwatch/commit/9227fb4b96184a82c87ab95f00fb985491df7224))

## [0.5.0](https://github.com/langwatch/langwatch/compare/mcp-server@v0.4.0...mcp-server@v0.5.0) (2026-02-20)


### Features

* add scenario management tools to MCP server ([#1705](https://github.com/langwatch/langwatch/issues/1705)) ([0376fde](https://github.com/langwatch/langwatch/commit/0376fde0abff7b110b4ec5996a399c4b2ceafde0))


### Miscellaneous

* **deps-dev:** bump @eslint/js from 9.35.0 to 9.39.2 in /mcp-server ([#1465](https://github.com/langwatch/langwatch/issues/1465)) ([fbee07d](https://github.com/langwatch/langwatch/commit/fbee07d8b964d0a059eaa32c7685c8bf667898e7))
* **deps:** bump hono ([f7e8f05](https://github.com/langwatch/langwatch/commit/f7e8f056843958cac4504ae02f37a351457f77ee))
* **deps:** bump hono from 4.11.9 to 4.12.0 in /mcp-server in the npm_and_yarn group across 1 directory ([#1736](https://github.com/langwatch/langwatch/issues/1736)) ([f7e8f05](https://github.com/langwatch/langwatch/commit/f7e8f056843958cac4504ae02f37a351457f77ee))
* **deps:** bump node-pty from 1.0.0 to 1.1.0 in /mcp-server ([#1447](https://github.com/langwatch/langwatch/issues/1447)) ([12ad02c](https://github.com/langwatch/langwatch/commit/12ad02c19dcc0ba90ad32f77659816b768188a53))
* **deps:** bump qs ([f0e9747](https://github.com/langwatch/langwatch/commit/f0e97475becd58dfa523a944fbb3fa0657dfc1dc))
* **deps:** bump qs from 6.14.1 to 6.14.2 in /mcp-server in the npm_and_yarn group across 1 directory ([#1568](https://github.com/langwatch/langwatch/issues/1568)) ([f0e9747](https://github.com/langwatch/langwatch/commit/f0e97475becd58dfa523a944fbb3fa0657dfc1dc))
* **deps:** bump the npm_and_yarn group across 1 directory with 8 updates ([#1519](https://github.com/langwatch/langwatch/issues/1519)) ([487e563](https://github.com/langwatch/langwatch/commit/487e5637a941fa9335ec8e951efdf38bb0a02a8c))
* **deps:** bump the uv group across 1 directory with 7 updates ([#1516](https://github.com/langwatch/langwatch/issues/1516)) ([7f2f178](https://github.com/langwatch/langwatch/commit/7f2f178588d89a63f3b38510844b87de7b528b3b))

## [0.4.0](https://github.com/langwatch/langwatch/compare/mcp-server@v0.3.3...mcp-server@v0.4.0) (2026-02-08)


### Features

* add CI/CD execution support for evaluations v3 ([#1118](https://github.com/langwatch/langwatch/issues/1118)) ([d28adac](https://github.com/langwatch/langwatch/commit/d28adaceeb87921d9c7c0f1cf76b5e03f3b90fbd))
* add observability and prompt MCP tools to @langwatch/mcp-server v0.4.0 ([#1410](https://github.com/langwatch/langwatch/issues/1410)) ([b770040](https://github.com/langwatch/langwatch/commit/b7700401dd87e7f1b76fefb213d67c906bcc1202))


### Bug Fixes

* **mcp-server:** skip integration test in CI ([#1300](https://github.com/langwatch/langwatch/issues/1300)) ([c16f232](https://github.com/langwatch/langwatch/commit/c16f2320b5c99818324d506a64ed3588085d8517))

## [0.3.3](https://github.com/langwatch/langwatch/compare/mcp-server@v0.3.2...mcp-server@v0.3.3) (2025-12-18)


### Miscellaneous

* trigger release ([#1011](https://github.com/langwatch/langwatch/issues/1011)) ([6173f53](https://github.com/langwatch/langwatch/commit/6173f53b041d9ee7e6b930270224954ba3c6621e))

## [0.3.2](https://github.com/langwatch/langwatch/compare/mcp-server@v0.3.1...mcp-server@v0.3.2) (2025-12-17)


### Bug Fixes

* update mcp docs urls to the new langwatch.ai/docs and /scenario instead of the previous subdomains ([5b1ce07](https://github.com/langwatch/langwatch/commit/5b1ce073adf580fb7f897da98e1cdd6a1e25135e))

## [0.3.1](https://github.com/langwatch/langwatch/compare/mcp-server@v0.3.0...mcp-server@v0.3.1) (2025-11-15)


### Bug Fixes

* sometimes the initial forward slash / is not sent by the llm ([2d63409](https://github.com/langwatch/langwatch/commit/2d63409e59e714b1a05c951edb8582c9fc39479f))

## [0.3.0](https://github.com/langwatch/langwatch/compare/mcp-server@v0.2.2...mcp-server@v0.3.0) (2025-11-15)


### Features

* remove the need of passing a langwatch api key for using the mcp ([#817](https://github.com/langwatch/langwatch/issues/817)) ([66e49b5](https://github.com/langwatch/langwatch/commit/66e49b5c640d0c220aa08e198fb4dbf24681d567))

## [0.2.2](https://github.com/langwatch/langwatch/compare/mcp-server@v0.2.1...mcp-server@v0.2.2) (2025-11-13)


### Bug Fixes

* fix fetching llms txt for first request ([#813](https://github.com/langwatch/langwatch/issues/813)) ([cd8de19](https://github.com/langwatch/langwatch/commit/cd8de19b2a06556cd3b89b6cc868db7aac563efc))

## [0.2.1](https://github.com/langwatch/langwatch/compare/mcp-server@v0.2.0...mcp-server@v0.2.1) (2025-11-08)


### Bug Fixes

* force fetching of only md files ([c8a9baf](https://github.com/langwatch/langwatch/commit/c8a9baf12f375dd48970e0882cd69a029c6d338f))

## [0.2.0](https://github.com/langwatch/langwatch/compare/mcp-server@v0.1.0...mcp-server@v0.2.0) (2025-11-07)


### Features

* add scenario docs fetching to mcp ([e630206](https://github.com/langwatch/langwatch/commit/e63020622ca192bf5801d4dbdd2744fb755075ed))

## [0.1.0](https://github.com/langwatch/langwatch/compare/mcp-server@v0.0.5...mcp-server@v0.1.0) (2025-09-19)


### Features

* added auto setup functionality for langwatch mcp ([#617](https://github.com/langwatch/langwatch/issues/617)) ([8c95b07](https://github.com/langwatch/langwatch/commit/8c95b07598a74285940b0c9267368543a9ced5e0))
* ci/cd steps for all packages and deployables, including improvements to caching and bundle sizes ([#351](https://github.com/langwatch/langwatch/issues/351)) ([e67a169](https://github.com/langwatch/langwatch/commit/e67a1694fec2f96479266454403928e9dc68a20f))


### Bug Fixes

* add missing dotenv dependency for running tests ([fb706ce](https://github.com/langwatch/langwatch/commit/fb706ceef9a298d070b264ad8b6da7c2df5e2a5d))
* judge agent for mcp-server test ([cd8e378](https://github.com/langwatch/langwatch/commit/cd8e3783ec02f02174ecb5fd86fa86c3f11e1734))
* mcp-server ci ([0ab6e51](https://github.com/langwatch/langwatch/commit/0ab6e513129d9b1fbdb7a696ce1d99ed6093dea3))
* run claude-code on the CI ([d760307](https://github.com/langwatch/langwatch/commit/d760307807c72a2a0e995a4f0a42845c2cc5114a))


### Documentation

* add detailed markdown documentation for LangWatch eval notebook ([#618](https://github.com/langwatch/langwatch/issues/618)) ([525b62a](https://github.com/langwatch/langwatch/commit/525b62ad6ea01f122297b1a3fd1eb7e842479f19))
* added mcp-server contributing guide ([19d1431](https://github.com/langwatch/langwatch/commit/19d14313824663842e5bba3a98986b9b80382300))
* improve notebook descriptions ([fa1f267](https://github.com/langwatch/langwatch/commit/fa1f26705bfff3143dbd6d16edfdae86bd5ce6bd))


### Code Refactoring

* split tool call fix helper ([c95028f](https://github.com/langwatch/langwatch/commit/c95028fba882357b33ca975e9d08ceabfe5cfc1c))
