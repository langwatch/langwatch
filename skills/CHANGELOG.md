# Changelog

## [1.3.0](https://github.com/langwatch/langwatch/compare/skills@v1.2.0...skills@v1.3.0) (2026-09-01)

### Features

- **agent-testing:** compare agents in one run ([#7654](https://github.com/langwatch/langwatch/issues/7654)) ([3e73916](https://github.com/langwatch/langwatch/commit/3e7391698f5e9b1cac2f8c5f0d0cacc9dec4d02a))
- **agent-testing:** v2 polish round 6 ([#7590](https://github.com/langwatch/langwatch/issues/7590)) ([1f9efad](https://github.com/langwatch/langwatch/commit/1f9efad30ab94e86d00f57ea478bf0685b437f23))
- **agents:** connected agents, a decorated function is a simulation target ([#7655](https://github.com/langwatch/langwatch/issues/7655)) ([56922c0](https://github.com/langwatch/langwatch/commit/56922c0ee429bd5a38717960c09ede0d1905c0c3))
- **experiments:** the workbench copilot measures before it edits ([#7550](https://github.com/langwatch/langwatch/issues/7550)) ([2343dd5](https://github.com/langwatch/langwatch/commit/2343dd587777edf8b567754fe3523ff9cd6b7b1c))
- **langy:** drive the experiments workbench as a prompt improvement copilot ([#7424](https://github.com/langwatch/langwatch/issues/7424)) ([1e0d104](https://github.com/langwatch/langwatch/commit/1e0d1040b39c13089ecca01e437a15d2590224ae))
- **langy:** minimal harness, own system prompt, scoped tools, outcome-based judge, overfit-resistant skills ([#7266](https://github.com/langwatch/langwatch/issues/7266)) ([084324f](https://github.com/langwatch/langwatch/commit/084324f9db077cdaea0cc822ff505485b593d278))
- **lwql:** workbench epic - granularity contract, run-by-chart-id, dashboard widgets, chart CLI, Langy skill, QA fixes ([#7474](https://github.com/langwatch/langwatch/issues/7474)) ([df4f775](https://github.com/langwatch/langwatch/commit/df4f775bd2a3d3547bad95822278a8ec69682a1c))

### Bug Fixes

- **agents:** a finished connected-agent run reaches its verdict, and the transcript stays whole ([#7696](https://github.com/langwatch/langwatch/issues/7696)) ([4f7b665](https://github.com/langwatch/langwatch/commit/4f7b665623e1e453e8f505c259f2351bd074ad72))
- **experiments:** an evaluator chip says what it checks, and the box has jq ([#7615](https://github.com/langwatch/langwatch/issues/7615)) ([2b113b3](https://github.com/langwatch/langwatch/commit/2b113b346c29f2e871d7d59d647420cdd63d11be))
- **experiments:** the numbers agree across the workbench, the results page and the CLI ([#7606](https://github.com/langwatch/langwatch/issues/7606)) ([07ade28](https://github.com/langwatch/langwatch/commit/07ade28e92ba93610c0e274c06f87beb1a3b81d9))
- **langy:** the transcript reads in the order the turn happened ([#7510](https://github.com/langwatch/langwatch/issues/7510)) ([ae7c39a](https://github.com/langwatch/langwatch/commit/ae7c39ad7a6779adfefdfced94f2fd71a4f412da))
- optional legacy answer fields, one vocabulary for test suites and run plans, and named targets for runs from code ([#7638](https://github.com/langwatch/langwatch/issues/7638)) ([6fd37f3](https://github.com/langwatch/langwatch/commit/6fd37f30428c9fc468230fa9e4a79e3dee8cc58f))
- **scenarios:** fix the seven defects found while dogfooding a customer onboarding demo ([#7271](https://github.com/langwatch/langwatch/issues/7271)) ([7eeac5b](https://github.com/langwatch/langwatch/commit/7eeac5ba6809ed217ce3179d0a1fbb7656f2db52))

### Miscellaneous

- **deps-dev:** bump the types group across 1 directory with 2 updates ([#6789](https://github.com/langwatch/langwatch/issues/6789)) ([7be2d04](https://github.com/langwatch/langwatch/commit/7be2d04c798b46a29b9b5b046dbb28a1e6c369e7))
- **deps:** bump chalk from 5.6.2 to 6.0.0 ([#6803](https://github.com/langwatch/langwatch/issues/6803)) ([82c62ea](https://github.com/langwatch/langwatch/commit/82c62eacb15d9a9ae33e5f4a14da82feaf1de033))

### Documentation

- **agent-simulations:** use the skill card on the connect-your-agent page ([#7155](https://github.com/langwatch/langwatch/issues/7155)) ([65307a1](https://github.com/langwatch/langwatch/commit/65307a16eebdc9c7dfbc97a0fd2f8de8d1683048))
- **agent-testing:** connect from a function beside your service startup ([#7698](https://github.com/langwatch/langwatch/issues/7698)) ([60e7d4c](https://github.com/langwatch/langwatch/commit/60e7d4cedd0b0d70ed271891b24b507a0258a05e))
- **agent-testing:** rename the section to Agent Testing and rewrite it for the shipped interface ([#7659](https://github.com/langwatch/langwatch/issues/7659)) ([eb2f4b6](https://github.com/langwatch/langwatch/commit/eb2f4b626ddf85ec8ba1f9b49186dc3c333828e5))
- give coding agents their own top-level section ([#7546](https://github.com/langwatch/langwatch/issues/7546)) ([058882c](https://github.com/langwatch/langwatch/commit/058882c08cfd9070210c9db2d0a46fe837647d28))

## [1.2.0](https://github.com/langwatch/langwatch/compare/skills@v1.1.0...skills@v1.2.0) (2026-08-18)

### Features

- **scenarios:** judge on remote traces with per-turn propagation and a local dev tunnel ([#7070](https://github.com/langwatch/langwatch/issues/7070)) ([56689a3](https://github.com/langwatch/langwatch/commit/56689a327857169ce0d458a08f9e105ef28e182b))
- **scenarios:** scenario run parameters and http secret references ([#6906](https://github.com/langwatch/langwatch/issues/6906)) ([a21b7a1](https://github.com/langwatch/langwatch/commit/a21b7a15f0a98e6a5a4754eea0b8a33729561d24))
- **sdk:** judge n-way target comparisons from the experiment SDKs ([#6863](https://github.com/langwatch/langwatch/issues/6863)) ([9c34d3c](https://github.com/langwatch/langwatch/commit/9c34d3c37418ecf6d29b0e521d66fca0661a45d8))

### Documentation

- rewrite marketing language in simple technical English ([#7020](https://github.com/langwatch/langwatch/issues/7020)) ([68faaf5](https://github.com/langwatch/langwatch/commit/68faaf577bf9623c7ffbf8e1a8a500deabf3e036))

### Code Refactoring

- **typescript:** move the workspace to TypeScript 7, and stop a typecheck filling a 9 GiB ceiling ([#7081](https://github.com/langwatch/langwatch/issues/7081)) ([f79b748](https://github.com/langwatch/langwatch/commit/f79b74898b6a921823ebd32c57ac2295d79e6113))

## [1.1.0](https://github.com/langwatch/langwatch/compare/skills@v1.0.0...skills@v1.1.0) (2026-08-05)

### Features

- **gateway:** align the REST provisioning surface with the service layer, six-scope budgets with live spend, per-key spend read, CLI n-by-n ([#6268](https://github.com/langwatch/langwatch/issues/6268)) ([5459a31](https://github.com/langwatch/langwatch/commit/5459a31a0f82a1c2579c084322fbaf46f290c985))

## [1.0.0](https://github.com/langwatch/langwatch/compare/skills@v0.7.0...skills@v1.0.0) (2026-07-24)

### Features

- agent issue reports, npx langwatch report at every access point ([#6101](https://github.com/langwatch/langwatch/issues/6101)) ([e881f8e](https://github.com/langwatch/langwatch/commit/e881f8e5ed5e24094e9c55e3f8d390c9ff2f43e4))
- **skills:** graduate to 1.0.0 ([71956da](https://github.com/langwatch/langwatch/commit/71956da12bcee9ffa927a7ac416794e7e0555dab))

### Bug Fixes

- post-merge codex and Langy dogfood batch ([#6073](https://github.com/langwatch/langwatch/issues/6073)) ([a5a1e5a](https://github.com/langwatch/langwatch/commit/a5a1e5ac92854fc5a9619373ea57591f7b702539))

## [0.7.0](https://github.com/langwatch/langwatch/compare/skills@v0.6.1...skills@v0.7.0) (2026-07-23)

### Features

- **cli:** agent-first `lw` CLI ([#5921](https://github.com/langwatch/langwatch/issues/5921)) ([efdaafc](https://github.com/langwatch/langwatch/commit/efdaafc09e8195720896315018f9bc05ee82020d))
- **langy:** event-sourced frontend, model-emitted cards, and a home built on one field ([#6027](https://github.com/langwatch/langwatch/issues/6027)) ([5d72c7e](https://github.com/langwatch/langwatch/commit/5d72c7efc7b27fbc683ed77df7a943d01fb6b7a9))
- **langy:** langy goes large - event driven orchestration, ideated on a design concept, made the go agent well tuff ([#5741](https://github.com/langwatch/langwatch/issues/5741)) ([5982038](https://github.com/langwatch/langwatch/commit/59820384139fdf275a799719fa677c3106b64ad1))
- **langy:** ship Langy in-product AI assistant — workers, GitHub PRs, setup ([#4913](https://github.com/langwatch/langwatch/issues/4913)) ([897f039](https://github.com/langwatch/langwatch/commit/897f039b05bb81b08636c3f559488e89910abe79))
- **langy:** stop a turn for real, choose what Langy sees, and a home to ask from (ADR-058) ([#6026](https://github.com/langwatch/langwatch/issues/6026)) ([a29667a](https://github.com/langwatch/langwatch/commit/a29667a4723b1db697ab21d7692e65ccb03685b4))
- separate experiments from online evaluations ([#5916](https://github.com/langwatch/langwatch/issues/5916)) ([27d66a6](https://github.com/langwatch/langwatch/commit/27d66a60f09b99477c2e139dff2dffa7ece8f144))
- **skills:** evolve the insight skills into a diagnosis-to-improvement ladder ([#5968](https://github.com/langwatch/langwatch/issues/5968)) ([f0b458d](https://github.com/langwatch/langwatch/commit/f0b458dd97041f5a29024e360130ca6cacf76593))

### Bug Fixes

- **docs:** repair SKILL.md downloads and restore SSR on skills directory pages ([#5946](https://github.com/langwatch/langwatch/issues/5946)) ([6114d40](https://github.com/langwatch/langwatch/commit/6114d4091d6826d8088f1c3a6190ffc4da178bfc))
- **langy:** hoist release_langy_enabled flag hook above early returns (React [#310](https://github.com/langwatch/langwatch/issues/310)) ([897f039](https://github.com/langwatch/langwatch/commit/897f039b05bb81b08636c3f559488e89910abe79))
- **langy:** red-team + expanded scenario coverage, fix root causes found along the way ([#5986](https://github.com/langwatch/langwatch/issues/5986)) ([48ccc7d](https://github.com/langwatch/langwatch/commit/48ccc7daa9fd5324b44779c6887247eb19c3d632))
- **security:** bump hono&gt;=4.12.25 and langsmith&gt;=0.8.18 ([5dd4178](https://github.com/langwatch/langwatch/commit/5dd41782beee86ce4333c255d0914357a4e9716d))
- **security:** bump hono&gt;=4.12.25 and langsmith&gt;=0.8.18 (Dependabot [#1500](https://github.com/langwatch/langwatch/issues/1500), [#1516](https://github.com/langwatch/langwatch/issues/1516)) ([#5211](https://github.com/langwatch/langwatch/issues/5211)) ([5dd4178](https://github.com/langwatch/langwatch/commit/5dd41782beee86ce4333c255d0914357a4e9716d))
- **security:** raise js-yaml and dompurify override floors (langwatch, skills, mastra example) ([bc79476](https://github.com/langwatch/langwatch/commit/bc79476fd684208745f4afb083fd5faa954ea79d))
- **security:** raise js-yaml and dompurify override floors across JS workspaces ([#5364](https://github.com/langwatch/langwatch/issues/5364)) ([bc79476](https://github.com/langwatch/langwatch/commit/bc79476fd684208745f4afb083fd5faa954ea79d))
- **security:** raise python-sdk bleach and onnx transitive floors ([#5542](https://github.com/langwatch/langwatch/issues/5542)) ([6abdc66](https://github.com/langwatch/langwatch/commit/6abdc6608ca8414a789e81e2b3c6f2aa42e03095))

## [0.6.1](https://github.com/langwatch/langwatch/compare/skills@v0.6.0...skills@v0.6.1) (2026-06-19)

### Bug Fixes

- **cli:** default login to project, guard against personal-project confusion ([#4728](https://github.com/langwatch/langwatch/issues/4728)) ([0e355ce](https://github.com/langwatch/langwatch/commit/0e355ce4b488334c63bd8a172ce669ca30fcaf8b))
- **deps:** consolidated npm security overrides across the monorepo (closes 18 alerts) ([#4650](https://github.com/langwatch/langwatch/issues/4650)) ([3a56a88](https://github.com/langwatch/langwatch/commit/3a56a884826d493c2d9690ae9359068c193a4725))

### Documentation

- **skills:** add TypeScript voice coverage to scenarios skill ([#4624](https://github.com/langwatch/langwatch/issues/4624)) ([752a5d8](https://github.com/langwatch/langwatch/commit/752a5d87fc2693a6eccd4bb41cf71c55bcd4f67a))

## [0.6.0](https://github.com/langwatch/langwatch/compare/skills@v0.5.0...skills@v0.6.0) (2026-06-03)

### Features

- **skills/scenarios:** nudge against custom runners and JSON-DSL abstractions ([#4510](https://github.com/langwatch/langwatch/issues/4510)) ([3b15cc4](https://github.com/langwatch/langwatch/commit/3b15cc4a8e3eaa4b88fdb24c0ea10cf10e786a56))

### Bug Fixes

- **skills/scenarios:** clarify per-adapter "how does this connect to my agent?" ([c6b514f](https://github.com/langwatch/langwatch/commit/c6b514f2116e7458634d8c57dcb1c91508df7669))
- **skills/scenarios:** clarify per-adapter how to connect the user's agent (voice section) ([#4505](https://github.com/langwatch/langwatch/issues/4505)) ([c6b514f](https://github.com/langwatch/langwatch/commit/c6b514f2116e7458634d8c57dcb1c91508df7669))

## [0.5.0](https://github.com/langwatch/langwatch/compare/skills@v0.4.1...skills@v0.5.0) (2026-06-02)

### Features

- **api-keys:** scope-based permissions with fine-grained categories + docs ([#4117](https://github.com/langwatch/langwatch/issues/4117)) ([3dca0f6](https://github.com/langwatch/langwatch/commit/3dca0f685f8df8333d22117581510b0f6e13442d))
- **skills/scenarios:** voice agents section + dogfood coverage ([#4504](https://github.com/langwatch/langwatch/issues/4504)) ([50a990c](https://github.com/langwatch/langwatch/commit/50a990c5703b821174b76282ca9938add8eadadd))

### Bug Fixes

- **deps:** bump hono to &gt;=4.12.18 across the monorepo (closes 22 alerts) ([#4457](https://github.com/langwatch/langwatch/issues/4457)) ([3e062b5](https://github.com/langwatch/langwatch/commit/3e062b50b44730e3e9b320b186d63a1a4ff993b8))
- **deps:** bump hono to &gt;=4.12.18 and @hono/node-server to &gt;=1.19.13 across the monorepo ([3e062b5](https://github.com/langwatch/langwatch/commit/3e062b50b44730e3e9b320b186d63a1a4ff993b8))
- **deps:** bump protobufjs to &gt;=7.5.6 in skills and mastra example ([#4014](https://github.com/langwatch/langwatch/issues/4014)) ([bf4908c](https://github.com/langwatch/langwatch/commit/bf4908cc12dda98bf039be684265f36e9bda1742))
- **deps:** bump protobufjs to clear CVE-2026-41242 across JS workspaces ([#3612](https://github.com/langwatch/langwatch/issues/3612)) ([f2f2c37](https://github.com/langwatch/langwatch/commit/f2f2c37a4dc2011e7463752e952172b6225c2b6d))
- **deps:** bump uuid to &gt;=11.1.1 across the monorepo (closes 7 alerts) ([#4470](https://github.com/langwatch/langwatch/issues/4470)) ([f22706b](https://github.com/langwatch/langwatch/commit/f22706b523526875ecd639d54c1e392d27cbcfae))
- **deps:** bump vitest to &gt;=4.1.0 across the monorepo (closes 9 CRITICAL alerts) ([#4495](https://github.com/langwatch/langwatch/issues/4495)) ([6f90ef4](https://github.com/langwatch/langwatch/commit/6f90ef48ae5b9436742bbda5d4bef21ea904db82))
- **deps:** patch high-severity npm vulnerabilities (fast-xml-builder, fast-uri) ([#3928](https://github.com/langwatch/langwatch/issues/3928)) ([2eb205b](https://github.com/langwatch/langwatch/commit/2eb205ba86e1ebd4c7f078c8dba746dd9f50b919))
- **deps:** upgrade langsmith sdk security floors ([2e18927](https://github.com/langwatch/langwatch/commit/2e18927c0c1c1fdec24c2bba17e5f094e56a9deb))
- **deps:** upgrade LangSmith SDK security floors ([#4041](https://github.com/langwatch/langwatch/issues/4041)) ([2e18927](https://github.com/langwatch/langwatch/commit/2e18927c0c1c1fdec24c2bba17e5f094e56a9deb))
- **prompts:** lossless structured-output and parameter sync between platform and local yaml ([#4068](https://github.com/langwatch/langwatch/issues/4068)) ([c3c5941](https://github.com/langwatch/langwatch/commit/c3c59417c916e4aaaba453723cb9f527834efbb8))
- **release:** path-routed Release-As shadows for 6 polluted components ([#3627](https://github.com/langwatch/langwatch/issues/3627)) ([b39d59e](https://github.com/langwatch/langwatch/commit/b39d59e87ed6d87224d580271175650c1d4159a7))
- **release:** scope Release-As to langwatch, restore other components ([#3618](https://github.com/langwatch/langwatch/issues/3618)) ([e259e79](https://github.com/langwatch/langwatch/commit/e259e796b50e4d060e5c7f42cad1927f1da8a83d))

### Miscellaneous

- **deps:** bump liquidjs to &gt;=10.26.0 (RCE GHSA-gf2q-c269-pqgc) in typescript-sdk, skills, mcp-server ([#4340](https://github.com/langwatch/langwatch/issues/4340)) ([697e07e](https://github.com/langwatch/langwatch/commit/697e07e82241dc837afb414458e67f539d23fb54))
- **deps:** bump liquidjs to &gt;=10.26.0 in typescript-sdk, skills, mcp-server (GHSA-gf2q-c269-pqgc) ([697e07e](https://github.com/langwatch/langwatch/commit/697e07e82241dc837afb414458e67f539d23fb54))
- release as 3.2.1 ([ca9d7a9](https://github.com/langwatch/langwatch/commit/ca9d7a9231a7b3d9d8cf9a28a48fa494b1daeb4b))
- release as 3.2.1 (override release-please from 3.3.0) ([#3615](https://github.com/langwatch/langwatch/issues/3615)) ([ca9d7a9](https://github.com/langwatch/langwatch/commit/ca9d7a9231a7b3d9d8cf9a28a48fa494b1daeb4b))
- scope Release-As to langwatch, restore other components ([e259e79](https://github.com/langwatch/langwatch/commit/e259e796b50e4d060e5c7f42cad1927f1da8a83d))
- **security:** add dependency age gates ([#3523](https://github.com/langwatch/langwatch/issues/3523)) ([78f5b20](https://github.com/langwatch/langwatch/commit/78f5b2059228748d19fb4bf74118c9bee6c474f9))
- **skills:** single-footer shadow Release-As 0.5.0 ([475f598](https://github.com/langwatch/langwatch/commit/475f598fcd0a2b9175ae021335a56568a6995894))

## [0.4.1](https://github.com/langwatch/langwatch/compare/skills@v0.4.0...skills@v0.4.1) (2026-04-24)

### Bug Fixes

- **skills-publish:** stop sync.sh nuking target repo's .git ([#3425](https://github.com/langwatch/langwatch/issues/3425)) ([72fef44](https://github.com/langwatch/langwatch/commit/72fef447db36d2a820a315d2818df9d6ec381512))

### Code Refactoring

- **skills:** real MDX with imports + JSX, retire link-as-partial sleight of hand ([#3432](https://github.com/langwatch/langwatch/issues/3432)) ([3141eb8](https://github.com/langwatch/langwatch/commit/3141eb8569071151c9969efa1a12a30401fd7792))

## [0.4.0](https://github.com/langwatch/langwatch/compare/skills@v0.3.0...skills@v0.4.0) (2026-04-23)

### Features

- **skills:** make skills CLI-only and add `langwatch docs` / `scenario-docs` ([#3274](https://github.com/langwatch/langwatch/issues/3274)) ([b7aefef](https://github.com/langwatch/langwatch/commit/b7aefefb006560f3e8ba8f49128522f8caeb1a7b))

### Miscellaneous

- **deps:** bump the npm_and_yarn group across 4 directories with 6 updates ([#3401](https://github.com/langwatch/langwatch/issues/3401)) ([63d21c7](https://github.com/langwatch/langwatch/commit/63d21c734d47dc629db6d3228d39976acf8b06cf))
- **deps:** bump the npm_and_yarn group across 7 directories with 8 updates ([#3286](https://github.com/langwatch/langwatch/issues/3286)) ([6939c5c](https://github.com/langwatch/langwatch/commit/6939c5cce6112b132a82f0c3105e86aab6568f45))

## [0.3.0](https://github.com/langwatch/langwatch/compare/skills@v0.2.0...skills@v0.3.0) (2026-04-17)

### Features

- add dataset generation skill with scenario tests ([#3217](https://github.com/langwatch/langwatch/issues/3217)) ([71c4b35](https://github.com/langwatch/langwatch/commit/71c4b351d78647de54e8c68c455b76821adce1ba))
- add prompt tag support to MCP tools, docs, and skills ([#2934](https://github.com/langwatch/langwatch/issues/2934)) ([858e0d7](https://github.com/langwatch/langwatch/commit/858e0d7df3df8c70822e2155a73453bf1a6fd324))
- full CLI, API, and MCP coverage for all platform features ([#3168](https://github.com/langwatch/langwatch/issues/3168)) ([921b7b9](https://github.com/langwatch/langwatch/commit/921b7b92d3ccc038556fe2241a3a90302786631e))
- **mcp:** add dataset mcp tools ([#2926](https://github.com/langwatch/langwatch/issues/2926)) ([666710c](https://github.com/langwatch/langwatch/commit/666710cbb1052f9b7180378a7c24490e4a103b9f))

### Bug Fixes

- make dataset upload to platform the primary goal ([#3232](https://github.com/langwatch/langwatch/issues/3232)) ([43616b6](https://github.com/langwatch/langwatch/commit/43616b6eb3d9abdca76b7e6efb0755404d3f8abd))
- **onboarding:** prevent ENAMETOOLONG crash in Gemini CLI on prompt paste ([#3107](https://github.com/langwatch/langwatch/issues/3107)) ([df6a446](https://github.com/langwatch/langwatch/commit/df6a4461dd9040d5c30cf702f192941061ca462e))
- require tag-based fetch pattern in scenario assertion ([#3098](https://github.com/langwatch/langwatch/issues/3098)) ([b20d605](https://github.com/langwatch/langwatch/commit/b20d605c0b6a7478805a4ac6716b08e12c1d08fe)), closes [#2939](https://github.com/langwatch/langwatch/issues/2939)
- **skills:** update MCP config schema for Claude Code compatibility ([#2927](https://github.com/langwatch/langwatch/issues/2927)) ([f85cf4e](https://github.com/langwatch/langwatch/commit/f85cf4e8ad67c518c1cb0f2ba830a6ad8ed00acc))

## [0.2.0](https://github.com/langwatch/langwatch/compare/skills@v0.1.0...skills@v0.2.0) (2026-03-29)

### Features

- add skills publish pipeline to langwatch/skills repo ([#2415](https://github.com/langwatch/langwatch/issues/2415)) ([9b769fe](https://github.com/langwatch/langwatch/commit/9b769fe8b6e11a18434e967564697a26c48f8aa0))
- auto-regenerate docs prompts + llms.txt via git hooks + CI ([#2686](https://github.com/langwatch/langwatch/issues/2686)) ([9f78ffa](https://github.com/langwatch/langwatch/commit/9f78ffae2257c8a233b318957f06aa264f9ccac1))
- **skills:** agent skills-based onboarding with feature map and scenario tests ([#2377](https://github.com/langwatch/langwatch/issues/2377)) ([6f6abdb](https://github.com/langwatch/langwatch/commit/6f6abdb67b97fcb7c2958dbc193dcde37d4c82a8))

### Bug Fixes

- include version.txt in skills publish sync ([#2417](https://github.com/langwatch/langwatch/issues/2417)) ([1cd6606](https://github.com/langwatch/langwatch/commit/1cd66066a90984530059eef502d29359c14bf0ea))
- **sdk+skills:** widen peer deps, fix scenario config, strengthen skill tests ([#2485](https://github.com/langwatch/langwatch/issues/2485)) ([c77237c](https://github.com/langwatch/langwatch/commit/c77237c8f5690f4eafcc96ed3334e3c6d61a7249))
