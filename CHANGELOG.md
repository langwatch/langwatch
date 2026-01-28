# Changelog

## [2.0.1](https://github.com/langwatch/langwatch/compare/langwatch@v2.0.0...langwatch@v2.0.1) (2026-01-28)


### Bug Fixes

* **licensing:** add production public key for license validation ([#1234](https://github.com/langwatch/langwatch/issues/1234)) ([1aba398](https://github.com/langwatch/langwatch/commit/1aba3983ae1dfdf31bef10ca13271714f2cebcd3))

## [2.0.0](https://github.com/langwatch/langwatch/compare/langwatch@v1.12.0...langwatch@v2.0.0) (2026-01-28)


### ⚠ BREAKING CHANGES

* Monitors now store evaluation level explicitly in 'level' column

### Features

* add AI scenario generation ([#1110](https://github.com/langwatch/langwatch/issues/1110)) ([7da469d](https://github.com/langwatch/langwatch/commit/7da469d8812a7ceaadfc667260a1201b98ac85d8))
* add CI/CD execution support for evaluations v3 ([#1118](https://github.com/langwatch/langwatch/issues/1118)) ([d28adac](https://github.com/langwatch/langwatch/commit/d28adaceeb87921d9c7c0f1cf76b5e03f3b90fbd))
* add COSS licensing enforcement for self-hosted deployments ([#1170](https://github.com/langwatch/langwatch/issues/1170)) ([37c30ec](https://github.com/langwatch/langwatch/commit/37c30ec30b344065aabd879b6a1f9a9e5181f1f4))
* add http agent ([#1053](https://github.com/langwatch/langwatch/issues/1053)) ([02284be](https://github.com/langwatch/langwatch/commit/02284be2b3e02f9dac4f9cc7b9041e84f836454a))
* add link to setup evaluations from sdk ([2130e30](https://github.com/langwatch/langwatch/commit/2130e30c171eb1cc6410ee00602bf6ba11e204b6))
* add orchestrator pattern for Claude Code context management ([#1163](https://github.com/langwatch/langwatch/issues/1163)) ([7b3415b](https://github.com/langwatch/langwatch/commit/7b3415be0984b6a44ed1a5bb06220df87fb58b1a))
* **analytics:** track onboarding progress metrics in PostHog ([1533de5](https://github.com/langwatch/langwatch/commit/1533de5beede58f1f1c697b39c63160105f704fe))
* **claude:** add rogerio-cto-review agent and worktree command ([#1192](https://github.com/langwatch/langwatch/issues/1192)) ([326196a](https://github.com/langwatch/langwatch/commit/326196a02998301198b38096aa2803d1fa2fd1c3))
* **claude:** add workflow commands for worktrees and PR review ([#1135](https://github.com/langwatch/langwatch/issues/1135)) ([8643e92](https://github.com/langwatch/langwatch/commit/8643e928c6e8e7d6915148a8a891ff1be402a045))
* clickhouse trace filtering ([#1079](https://github.com/langwatch/langwatch/issues/1079)) ([12f4b03](https://github.com/langwatch/langwatch/commit/12f4b0327eaee774b48c14f9ae0b6833f9044d48))
* **dev:** add Docker Compose dev environment with profiles ([#1188](https://github.com/langwatch/langwatch/issues/1188)) ([72e8df5](https://github.com/langwatch/langwatch/commit/72e8df5147490db7f455cfbc9c6cb7cf32def06f))
* evaluations v3 execution and new evaluations results page ([#1113](https://github.com/langwatch/langwatch/issues/1113)) ([510f65d](https://github.com/langwatch/langwatch/commit/510f65d17e13c539b877e7eed2fefff118ceb705))
* **evaluations-v3:** add lambda warmup for faster evaluation runs ([cc95cca](https://github.com/langwatch/langwatch/commit/cc95cca172ab3ad39c4a81d4b8e2c850f22793d9))
* **evaluations-v3:** implement HTTP agent support ([#1196](https://github.com/langwatch/langwatch/issues/1196)) ([7afb24e](https://github.com/langwatch/langwatch/commit/7afb24ea0691d18ab79f2f82091c459a5f7e1810))
* **evaluations-v3:** improve table column resizing and overflow handling ([d1d3831](https://github.com/langwatch/langwatch/commit/d1d3831479d6718ea4bd0d2444a5c0131e74f2e3))
* **evaluations-v3:** major table performance improvements, prompts to experiment button and other bugfixes ([#1181](https://github.com/langwatch/langwatch/issues/1181)) ([2cbf430](https://github.com/langwatch/langwatch/commit/2cbf4303f670edcd65a81f3af4d7a00a85b13010))
* **evaluations-v3:** support evaluators/{id} path for database evaluators ([2f65327](https://github.com/langwatch/langwatch/commit/2f653271fe793d19d5da4cf39c187586bbb2ef1a))
* **evaluators:** add "Use via API" dialog with code snippets ([58ccaf5](https://github.com/langwatch/langwatch/commit/58ccaf5a58d80cab941dfc4d2985623e3134cd87))
* event sourcing powered evaluations ([#1090](https://github.com/langwatch/langwatch/issues/1090)) ([fd9898e](https://github.com/langwatch/langwatch/commit/fd9898e1217f60f52d25d1610998a5810eb02c57))
* improve trace/span event sourcing pipeline ([#980](https://github.com/langwatch/langwatch/issues/980)) ([d67854d](https://github.com/langwatch/langwatch/commit/d67854d8433bf9a08bc4de59e32e7e06b0ff0ddc))
* integrate HTTP agent into scenario/simulations quick run ([#1071](https://github.com/langwatch/langwatch/issues/1071)) ([3e3a8d4](https://github.com/langwatch/langwatch/commit/3e3a8d4918d4889f028b86837fd055f9d490fd4d))
* introduce first step towards dark mode ([#1143](https://github.com/langwatch/langwatch/issues/1143)) ([426d776](https://github.com/langwatch/langwatch/commit/426d776c39d1696b7e4ea45b1feead847c8e0de5))
* **licensing:** add centralized license enforcement with resource limits ([#1208](https://github.com/langwatch/langwatch/issues/1208)) ([a511233](https://github.com/langwatch/langwatch/commit/a511233acb4e4cf739ad569e23f06ae3cac6bdb3))
* **llm-config:** upgrade model registry with dynamic parameters and OpenRouter sync ([#1115](https://github.com/langwatch/langwatch/issues/1115)) ([f03a283](https://github.com/langwatch/langwatch/commit/f03a283c1e49fa4127bbc82d01f301c6cc3fcf49))
* new online evaluations and guardrails setup ([#1151](https://github.com/langwatch/langwatch/issues/1151)) ([7c8a804](https://github.com/langwatch/langwatch/commit/7c8a804e265946a9a96e44b110f17266abaafc73))
* new simulation card design ([#1106](https://github.com/langwatch/langwatch/issues/1106)) ([3a116af](https://github.com/langwatch/langwatch/commit/3a116af08d8297183960eb403af4004e3341c8c5))
* **projects:** add drawer-based project creation ([#1068](https://github.com/langwatch/langwatch/issues/1068)) ([5620034](https://github.com/langwatch/langwatch/commit/562003496e9e4402c9a43a707e4145a92069f13d))
* **prompts:** show icon-only buttons with tooltips in compare mode ([4f4ecfe](https://github.com/langwatch/langwatch/commit/4f4ecfe4a1dc4cf5397f10a14a7a11ec5c1c3a1b))
* refactor model providers UI to drawer-based ([#1050](https://github.com/langwatch/langwatch/issues/1050)) ([8c8df73](https://github.com/langwatch/langwatch/commit/8c8df73cc799cb82c6f8332c239ba66ffa74c3da))
* regenerate api key ([#1083](https://github.com/langwatch/langwatch/issues/1083)) ([e09bf3f](https://github.com/langwatch/langwatch/commit/e09bf3f51c29cca81611c1198f134ec9530231f7))
* **scenarios:** add help text and tooltips to scenario form fields ([#1128](https://github.com/langwatch/langwatch/issues/1128)) ([fec3e73](https://github.com/langwatch/langwatch/commit/fec3e73fe239ae51e6e9936a122f339a6afb694a))
* **sdk:** add online evaluations API and ensureSetup for TypeScript ([2209258](https://github.com/langwatch/langwatch/commit/22092580433b9a3014123e62f39cf8c44543d8cc))
* **traces:** add reasoning tokens and effort support for LLM models ([16f1d4a](https://github.com/langwatch/langwatch/commit/16f1d4a80f1425d85c5f700da01287a2415bdd88))
* track events as spans for REST API ([#1089](https://github.com/langwatch/langwatch/issues/1089)) ([ec8243e](https://github.com/langwatch/langwatch/commit/ec8243ece7b55767e3823f294a307b568e533203))
* **ui:** revamp LLM parameter controls with button-based selects ([9a42d93](https://github.com/langwatch/langwatch/commit/9a42d930797c4c48cd79b0cf3758da2b9c6a3365))
* update onboarding for new go sdk shape ([#1225](https://github.com/langwatch/langwatch/issues/1225)) ([ae6b6a2](https://github.com/langwatch/langwatch/commit/ae6b6a25d08219dc848c777e9912d80397b2edba))
* use programmatic langwatch config in scenario runner ([#1074](https://github.com/langwatch/langwatch/issues/1074)) ([34a9d62](https://github.com/langwatch/langwatch/commit/34a9d62417cd6a25f70d6a166898108170eb50e3))
* walking skeleton for scenarios ([#1047](https://github.com/langwatch/langwatch/issues/1047)) ([f6acbb8](https://github.com/langwatch/langwatch/commit/f6acbb822696ff1818ee853825bb6c11db857953))


### Bug Fixes

* add vendor folder before installation to fix docker build ([292fe83](https://github.com/langwatch/langwatch/commit/292fe837cbd09babcf32dd4cc83f49b99a6bd3c3))
* add z-index to tooltip ([#1078](https://github.com/langwatch/langwatch/issues/1078)) ([1804329](https://github.com/langwatch/langwatch/commit/180432967a6644e0e3b9dd6a3507ad4e8a7a311e))
* annotation highlight scroll ([#1073](https://github.com/langwatch/langwatch/issues/1073)) ([7e3471d](https://github.com/langwatch/langwatch/commit/7e3471d3aa104177cc1fb431d9890aefece0e369))
* base64 markdown rendering ([8017548](https://github.com/langwatch/langwatch/commit/8017548ae98538d8d55a40f70d6da0d722d34d48))
* check if graph exists ([#1067](https://github.com/langwatch/langwatch/issues/1067)) ([eef4089](https://github.com/langwatch/langwatch/commit/eef4089ddda25e1b814c54ccb9fff6dc07de4137))
* **ci:** add pnpm-lock.yaml for agentic-e2e-tests ([#1216](https://github.com/langwatch/langwatch/issues/1216)) ([761a1a0](https://github.com/langwatch/langwatch/commit/761a1a0a3df24ae9f086b4810a57d2112fe27664))
* clickhouse replication issue with goose migrations + tables not replicating correctly ([#1116](https://github.com/langwatch/langwatch/issues/1116)) ([db6638f](https://github.com/langwatch/langwatch/commit/db6638fc77fd999fc563c50ef8e1d9ec064a641e))
* cluster goose db ([#1140](https://github.com/langwatch/langwatch/issues/1140)) ([2cc0e69](https://github.com/langwatch/langwatch/commit/2cc0e6971b16143b4a0857a10dc10e8da68036cf))
* **config:** disable HSTS and upgrade-insecure-requests in development ([#1149](https://github.com/langwatch/langwatch/issues/1149)) ([f88086e](https://github.com/langwatch/langwatch/commit/f88086e6ba3dd9eee47d61cc88bd50394d3e93d2))
* **dspy:** capture full message output including reasoning_content ([8257cae](https://github.com/langwatch/langwatch/commit/8257cae1b9a4dbe8be8e7001fa88d7a0e3de6653))
* elasticsearch migrations for batch evals for new target fields ([530bb73](https://github.com/langwatch/langwatch/commit/530bb73426a470ede12dca56d311d79ded0a74f2))
* **evaluations-v3:** display Code Agent outputs with custom field names ([#1226](https://github.com/langwatch/langwatch/issues/1226)) ([9a69c53](https://github.com/langwatch/langwatch/commit/9a69c53bed7a391e53687634b9bc2a0d62a4509b))
* **evaluations-v3:** fix type errors in httpAgentUtils and dslAdapter ([3196cc7](https://github.com/langwatch/langwatch/commit/3196cc7adaf177b965fd1409c8038d27db8a403a))
* **evaluations-v3:** pass all LLM params including reasoning to targets ([c786a73](https://github.com/langwatch/langwatch/commit/c786a733bb13d82fb3894c6a63b7065d75dccba7))
* **evaluations-v3:** persist all LLM parameters in local prompt config ([4b87561](https://github.com/langwatch/langwatch/commit/4b875619557a9b66dc440ffb3029d97e02a64b7b))
* **evaluations-v3:** prevent autosave data loss on back navigation ([335e571](https://github.com/langwatch/langwatch/commit/335e571c63d491662cff36d4522ec01454b7a10a))
* event sourcing improvements from testing ([#1109](https://github.com/langwatch/langwatch/issues/1109)) ([2a400db](https://github.com/langwatch/langwatch/commit/2a400db59f85d665e1d34355b6df8ebb8dfe80e7))
* fix emojis without breaking multiline prompt evaluators anymore ([2d47925](https://github.com/langwatch/langwatch/commit/2d4792575b96679d10780d16088109ce3e30bd3c))
* fix failing unit tests ([9f9ad87](https://github.com/langwatch/langwatch/commit/9f9ad87a3348ec143b41f3be12f2c99a6fb49dea))
* goose migrate missing priming row ([#1145](https://github.com/langwatch/langwatch/issues/1145)) ([5698c57](https://github.com/langwatch/langwatch/commit/5698c57f401be8b06379b5cd10efca0c94a554d6))
* goose migration directory was wrong in dockerfile ([#1105](https://github.com/langwatch/langwatch/issues/1105)) ([ecd620b](https://github.com/langwatch/langwatch/commit/ecd620bb30fc11a76c242178127e69c55de543fe))
* improve dedupe logic, and fix span dropping issue in span storage event handler ([#1201](https://github.com/langwatch/langwatch/issues/1201)) ([3b43fae](https://github.com/langwatch/langwatch/commit/3b43fae3ac6905923f06f4aff0765076a299c754))
* improve locking contention delay config and error handling ([#1171](https://github.com/langwatch/langwatch/issues/1171)) ([5d84748](https://github.com/langwatch/langwatch/commit/5d84748fdf555c4cfa48d413737878cadec32bac))
* light mode token changes + hide theme selector if no feature flag ([#1152](https://github.com/langwatch/langwatch/issues/1152)) ([6729925](https://github.com/langwatch/langwatch/commit/672992501322e9a263e377e28cb5ca72b064c7fc))
* **litellm:** fix Anthropic model integration issues ([#1197](https://github.com/langwatch/langwatch/issues/1197)) ([1ed2c7f](https://github.com/langwatch/langwatch/commit/1ed2c7fdfe61a9516d6a889d667ab1ba98792423))
* **llm-config:** smart max_tokens handling on model switch ([7513131](https://github.com/langwatch/langwatch/commit/75131316abc33d89422d9594d6cccd7c7c3cb087))
* make otlp validation and parsing less strict, to support more otlp protocol versions ([#1148](https://github.com/langwatch/langwatch/issues/1148)) ([dc1e1eb](https://github.com/langwatch/langwatch/commit/dc1e1eb828c4abcfee9b48e1423e12f9db123659))
* navigation to the same drawer url, get the trace id button on the conversation working again ([f906f56](https://github.com/langwatch/langwatch/commit/f906f56089b29fd7b1682771207d4ed0f8c25498))
* normalize otlp ids to guaranteed otel ids ([#1164](https://github.com/langwatch/langwatch/issues/1164)) ([2e54acb](https://github.com/langwatch/langwatch/commit/2e54acb386e181513e837100441e96fbb3941fec))
* normalize span IDs to hex strings before BullMQ queue ([2e54acb](https://github.com/langwatch/langwatch/commit/2e54acb386e181513e837100441e96fbb3941fec))
* **onboarding:** prevent model provider credential inputs from resetting ([#1060](https://github.com/langwatch/langwatch/issues/1060)) ([ca8b8ee](https://github.com/langwatch/langwatch/commit/ca8b8ee311810aa48f28d10f91a3499534371675))
* **prompts:** default maxTokens to undefined for model-based defaults ([4a36aee](https://github.com/langwatch/langwatch/commit/4a36aee9d30504ddbb668b1bde4a9132f831e2ea))
* **prompts:** show Bedrock models in model selector dropdown ([#1206](https://github.com/langwatch/langwatch/issues/1206)) ([2e49e01](https://github.com/langwatch/langwatch/commit/2e49e01c7634795d8e7811dadbcd0d92a1cf263f))
* **prompts:** structured outputs with custom field names and types ([#1112](https://github.com/langwatch/langwatch/issues/1112)) ([d1c0370](https://github.com/langwatch/langwatch/commit/d1c03708221275bc2b4d6b7b62188913ed812697))
* **prompts:** use model's actual max_tokens for new prompts ([5aaa234](https://github.com/langwatch/langwatch/commit/5aaa23417e216cb04aaaac9553fdecaf4fb69529))
* proper terminology on analytics and add linking button for the graph ([15e3c2c](https://github.com/langwatch/langwatch/commit/15e3c2cb4dedabaef83754f7b8ffd1ce68ec4290))
* properly handle clickhouse engine tag macros for replicated cluster configs ([#1111](https://github.com/langwatch/langwatch/issues/1111)) ([6052374](https://github.com/langwatch/langwatch/commit/6052374329356b7d0ee12a44194291ad0d0a52f8))
* **python-sdk:** resolve name collision between Evaluation TypedDict and class alias ([873909a](https://github.com/langwatch/langwatch/commit/873909a09414bb309fa955b68e4a19bddc93e21f))
* react imports on deja view ([#1160](https://github.com/langwatch/langwatch/issues/1160)) ([6514a1a](https://github.com/langwatch/langwatch/commit/6514a1a8851ab9c1d587db8f0971237581e03b00))
* remove duplicate evaluations unit test (already in integration) ([#1177](https://github.com/langwatch/langwatch/issues/1177)) ([8ed9d28](https://github.com/langwatch/langwatch/commit/8ed9d28a413d626012a53d31f2599df525eb0380))
* rework pie/donut data and colours ([#1055](https://github.com/langwatch/langwatch/issues/1055)) ([8d50910](https://github.com/langwatch/langwatch/commit/8d50910ca442e0cdcb5cb6007c37351a14bdacf2))
* scenario editor UX improvements and bug fixes ([#1086](https://github.com/langwatch/langwatch/issues/1086)) ([1d44f72](https://github.com/langwatch/langwatch/commit/1d44f7212413fe83dfc51af4fa13ff727fc47819))
* set correct ksuid environment in worker ([#1173](https://github.com/langwatch/langwatch/issues/1173)) ([10ec064](https://github.com/langwatch/langwatch/commit/10ec064de252cf15604d9848ecfab9f12b388176))
* small project drawer title fix, make + Add clickable ([9746fdb](https://github.com/langwatch/langwatch/commit/9746fdb6b353568f35de4958f47ee733a1de84f2))
* **tests:** align license router tests with RBAC middleware behavior ([#1207](https://github.com/langwatch/langwatch/issues/1207)) ([1def54d](https://github.com/langwatch/langwatch/commit/1def54de02861d583d89c18b7bb601fb840266f2))
* **tests:** normalize column IDs to names in orchestrator integration test ([dc7c2ea](https://github.com/langwatch/langwatch/commit/dc7c2ead6a5fcdeb61557e068dc9c574dc41c7c6))
* unit tests and typecheck ([802ccc1](https://github.com/langwatch/langwatch/commit/802ccc17c3c65841034f26f18825e6e9bf7ccff8))
* various evaluations v3 fixes ([#1122](https://github.com/langwatch/langwatch/issues/1122)) ([c9904fc](https://github.com/langwatch/langwatch/commit/c9904fc898a7982ec0b23b11fcfeed83f34fbeb7))


### Miscellaneous

* ✨ new readme preview video 💅🏼  ([#1036](https://github.com/langwatch/langwatch/issues/1036)) ([ba949c5](https://github.com/langwatch/langwatch/commit/ba949c559eca591082bd392e449cefdf9b650964))
* eval pagination footer ([#1044](https://github.com/langwatch/langwatch/issues/1044)) ([aaea14f](https://github.com/langwatch/langwatch/commit/aaea14f268298978d5429e080287aeb2c34cef3e))
* fix all biome lint issues ([#1121](https://github.com/langwatch/langwatch/issues/1121)) ([d83bb6e](https://github.com/langwatch/langwatch/commit/d83bb6e4379148b48f5b8230648eac7598169681))
* improve stressed+blessed event sourcing tooling ([#1108](https://github.com/langwatch/langwatch/issues/1108)) ([82ccab6](https://github.com/langwatch/langwatch/commit/82ccab60ffc400298134831b224279b31e374ac3))
* **main:** release python-sdk 0.10.0 ([#1142](https://github.com/langwatch/langwatch/issues/1142)) ([749a977](https://github.com/langwatch/langwatch/commit/749a977afc8efaf6e417e11cd155827ff54c18e6))
* **main:** release python-sdk 0.9.0 ([#1114](https://github.com/langwatch/langwatch/issues/1114)) ([0f24551](https://github.com/langwatch/langwatch/commit/0f245515164052b9c3b798c007f644b690b7b7ed))
* migrate Cursor config to Claude Code system ([#1147](https://github.com/langwatch/langwatch/issues/1147)) ([fc20384](https://github.com/langwatch/langwatch/commit/fc20384cf89e93b24d25ab645ac1e9dfeb9e3673))
* remove litellm enterprise deps, add license file generation ([792243a](https://github.com/langwatch/langwatch/commit/792243a4e936094e33141905b0544b60cbb77e28))
* standardize top-level rules on AGENTS.md, remove duplicate CLAUDE.md ([#1150](https://github.com/langwatch/langwatch/issues/1150)) ([43ba172](https://github.com/langwatch/langwatch/commit/43ba172f9a60fbce04c9446c9d35a2eac3708207))
* sync model registry ([43bb203](https://github.com/langwatch/langwatch/commit/43bb20307f5535ba87a13db9ea6414f8fbee4f87))
* sync model registry (363 models) ([#1138](https://github.com/langwatch/langwatch/issues/1138)) ([43bb203](https://github.com/langwatch/langwatch/commit/43bb20307f5535ba87a13db9ea6414f8fbee4f87))
* update where goose migration db is stored + improve handling ([#1141](https://github.com/langwatch/langwatch/issues/1141)) ([e9265ed](https://github.com/langwatch/langwatch/commit/e9265ed44c8c675b166a62e1096a126e630c3c9e))


### Documentation

* add Repository + Service pattern documentation ([#1190](https://github.com/langwatch/langwatch/issues/1190)) ([fa6a81e](https://github.com/langwatch/langwatch/commit/fa6a81e792e0d0f8f762efd55f2caa3461557e65))
* extract design principles from PR [#1025](https://github.com/langwatch/langwatch/issues/1025) into searchable documentation ([#1139](https://github.com/langwatch/langwatch/issues/1139)) ([41e57d2](https://github.com/langwatch/langwatch/commit/41e57d279f1a5ff552d4cbfea212a26446a5d5c3))
* improve Claude Code agent configuration and BDD workflow ([#1189](https://github.com/langwatch/langwatch/issues/1189)) ([e2a1e2d](https://github.com/langwatch/langwatch/commit/e2a1e2da8809fd3223ae048ef93824ec44f06a68))
* move TESTING.md to docs/TESTING_PHILOSOPHY.md ([#1157](https://github.com/langwatch/langwatch/issues/1157)) ([c475c86](https://github.com/langwatch/langwatch/commit/c475c8692f461dc737a082ca687db101a74be9fb))
* standardize worktree and branch naming conventions ([#1211](https://github.com/langwatch/langwatch/issues/1211)) ([c3ef006](https://github.com/langwatch/langwatch/commit/c3ef0060715d60b9a36e0ca24199df2e73114fa1))


### Code Refactoring

* extract SSRF protection utils and remove cruft files ([#1065](https://github.com/langwatch/langwatch/issues/1065)) ([12ece04](https://github.com/langwatch/langwatch/commit/12ece048d95334bb989d4756909772c682f6d394))
* **sdk:** fix evaluation API naming consistency ([3aef2a3](https://github.com/langwatch/langwatch/commit/3aef2a353cc4939c8087b53044f441e7501530ae))
* **sdk:** rename evaluation API to experiment for new terminology ([f10326c](https://github.com/langwatch/langwatch/commit/f10326c0f2ee5818fbcf51507a95933bfe83caeb))
* **sdk:** rename internal evaluation classes to experiment ([ff70cab](https://github.com/langwatch/langwatch/commit/ff70cab904905b85a77a68e7b1eb60e9c364a18d))

## [1.12.0](https://github.com/langwatch/langwatch/compare/langwatch@v1.11.0...langwatch@v1.12.0) (2026-01-06)


### Features

* add custom dashboards with drag-drop and resizable graphs ([#996](https://github.com/langwatch/langwatch/issues/996)) ([1e4721c](https://github.com/langwatch/langwatch/commit/1e4721c66b969f8f84b513ac3728ad77820bc3c2))
* add database-backed agents and evaluators management ([#1032](https://github.com/langwatch/langwatch/issues/1032)) ([2758a0a](https://github.com/langwatch/langwatch/commit/2758a0a938aefd29eb62ef2e168dec6590fb489c))
* add GDPR user deletion script for compliance ([#1034](https://github.com/langwatch/langwatch/issues/1034)) ([089cb2b](https://github.com/langwatch/langwatch/commit/089cb2b614bdb7be9e8470a067cd7e0edd252540))
* add keyword subfield to metadata.name for sorting support ([#1007](https://github.com/langwatch/langwatch/issues/1007)) ([0a2559e](https://github.com/langwatch/langwatch/commit/0a2559e8f6639280d69179a2abb5794a67c8d10c))
* alerting on custom reports ([#995](https://github.com/langwatch/langwatch/issues/995)) ([9a071e6](https://github.com/langwatch/langwatch/commit/9a071e6c146cfdd2ee1a1be80de7cf5e2515fecb))
* **evaluations-v3:** major prompt management upgrades and redesign ([#1042](https://github.com/langwatch/langwatch/issues/1042)) ([fa08d5f](https://github.com/langwatch/langwatch/commit/fa08d5fa639038f6c38fa52bc9523b7a6b42e9c4))
* replicate evaluations ([#1004](https://github.com/langwatch/langwatch/issues/1004)) ([98d2166](https://github.com/langwatch/langwatch/commit/98d2166ad32232fa3c64f561e80e13dbe8fa0867))
* **ui:** langwatch 2026 design ([#1025](https://github.com/langwatch/langwatch/issues/1025)) ([61d53b6](https://github.com/langwatch/langwatch/commit/61d53b656a383708e59ccd667771e81af207c229))


### Bug Fixes

* 2026 redesign patches 1 ([#1027](https://github.com/langwatch/langwatch/issues/1027)) ([dbe118d](https://github.com/langwatch/langwatch/commit/dbe118def9c72e9622c1786f693a105361c44907))
* 2026 redesign patches 2 ([#1028](https://github.com/langwatch/langwatch/issues/1028)) ([e7499ef](https://github.com/langwatch/langwatch/commit/e7499effa4f9b0d9ee9370161720917d05a3a5f5))
* commit missing test fixes ([7562a68](https://github.com/langwatch/langwatch/commit/7562a680ef74c200fcf449889f4e0fac3f2e75a2))
* copy workflow bug ([#1003](https://github.com/langwatch/langwatch/issues/1003)) ([b64a051](https://github.com/langwatch/langwatch/commit/b64a0516ec6a132c007a8dbb2032cf77459c9a99))
* custom alert resolved fix ([#1046](https://github.com/langwatch/langwatch/issues/1046)) ([eb8fbf3](https://github.com/langwatch/langwatch/commit/eb8fbf34da2021a50d4f719e84721cf22a4bf3e5))
* improve backend error capturing of whole python-sdk to forward the human readable error message, and improve auto parsing of contexts for evaluation ([7ed0623](https://github.com/langwatch/langwatch/commit/7ed06235ecf14091c4cad33a5331a4d0819e9a27))
* reraise when 'error' is not available ([40530a2](https://github.com/langwatch/langwatch/commit/40530a2de08ce796dcc4ad9a0a97cd661044dbf1))
* **simulations:** display trace messages in CopilotKit chat and fix icon ([#1018](https://github.com/langwatch/langwatch/issues/1018)) ([313aa24](https://github.com/langwatch/langwatch/commit/313aa24b00593218d291e48fad4aa8cbbe605553))
* types ([e4ecb11](https://github.com/langwatch/langwatch/commit/e4ecb11c6df6044dcd9ab68d809c41a0eb588d80))


### Miscellaneous

* **main:** release python-sdk 0.8.1 ([#1014](https://github.com/langwatch/langwatch/issues/1014)) ([d792162](https://github.com/langwatch/langwatch/commit/d792162853a128f141295df231439e343c2ad92b))
* move GDPR deletion tasks to langwatch-saas ([#1038](https://github.com/langwatch/langwatch/issues/1038)) ([b8d2aa8](https://github.com/langwatch/langwatch/commit/b8d2aa8138b255265fb6818ee1c014ea10ff42a8))

## [1.11.0](https://github.com/langwatch/langwatch/compare/langwatch@v1.10.0...langwatch@v1.11.0) (2025-12-16)


### Features

* add migrations for clickhouse datastore ([#916](https://github.com/langwatch/langwatch/issues/916)) ([509fbe6](https://github.com/langwatch/langwatch/commit/509fbe61b7f9182c280ecac2aca7b44ccdda0344))
* allow to filter on analytics group ([#991](https://github.com/langwatch/langwatch/issues/991)) ([0037046](https://github.com/langwatch/langwatch/commit/0037046c62640187fd80bc10254a4c50492bbce7))
* audit logs ([#908](https://github.com/langwatch/langwatch/issues/908)) ([43b59ce](https://github.com/langwatch/langwatch/commit/43b59ce1857108ce5376e75f8946442fb9503425))
* copy project workflows and datasets ([#864](https://github.com/langwatch/langwatch/issues/864)) ([e3e4292](https://github.com/langwatch/langwatch/commit/e3e4292062c275b8d6ad7207adafca914bcafcc5))
* implement adaptive throttling for cold storage migration ([075b63f](https://github.com/langwatch/langwatch/commit/075b63f54a3eb95de351cdb7299c8c29d123efb5))
* implement FetchPolicy enum for Python SDK  ([#989](https://github.com/langwatch/langwatch/issues/989)) ([43de904](https://github.com/langwatch/langwatch/commit/43de904de08ec54a78aece35da155a8a3cb4289d))
* migrate from npm to pnpm ([#940](https://github.com/langwatch/langwatch/issues/940)) ([ce52474](https://github.com/langwatch/langwatch/commit/ce52474c3023ccb4714e4a33373d3c644f1496bf))
* **scenario-events:** add trace limit middleware to block requests w… ([#935](https://github.com/langwatch/langwatch/issues/935)) ([7af7793](https://github.com/langwatch/langwatch/commit/7af77934be2486359dcf43fe2612b1792ca57bf1))


### Bug Fixes

* auto-correct reasoning model config for DSPy compatibility ([#978](https://github.com/langwatch/langwatch/issues/978)) ([#979](https://github.com/langwatch/langwatch/issues/979)) ([47e45b6](https://github.com/langwatch/langwatch/commit/47e45b67ec33ff7870e6faf734ff4244c8e49f64))
* defaults for gpt-5 and default model deleting during execution ([6d3d8a8](https://github.com/langwatch/langwatch/commit/6d3d8a8235f5c4e7d96b3231284284e3f24ff726))
* display scenario runs with errors when MESSAGE_SNAPSHOT is missing ([#985](https://github.com/langwatch/langwatch/issues/985)) ([6642080](https://github.com/langwatch/langwatch/commit/664208038d518ce3c1a673f933c86a4c6789d6cb)), closes [#984](https://github.com/langwatch/langwatch/issues/984)
* do not skip running evaluation on traces if they have error but also input and output ([8ec6140](https://github.com/langwatch/langwatch/commit/8ec61400b15cbcedf130ab4dad3b29d8746196e9))
* improve handling of clickhouse url parsing ([#933](https://github.com/langwatch/langwatch/issues/933)) ([aafe164](https://github.com/langwatch/langwatch/commit/aafe164e1c5058576dc26b02c1d7225acc652cad))
* increase the delay for evaluations to not run twice, many agents actually can take 30s to run in normal conditions ([b758e8b](https://github.com/langwatch/langwatch/commit/b758e8b59fd938e27e8e661fb80db50d8e287831))
* metadata tags filter traces when clicked ([#963](https://github.com/langwatch/langwatch/issues/963)) ([75f7359](https://github.com/langwatch/langwatch/commit/75f7359f7533462f21dad7fe00b323ed6dac0574))
* **prompts-api:** derive output schema from storage to prevent drift ([#952](https://github.com/langwatch/langwatch/issues/952)) ([d8c3536](https://github.com/langwatch/langwatch/commit/d8c3536d7f6497cf4fe7ee459fa6f79b25d90d32))
* rerun evaluations if new spans arrive even after 30s but less than 1h ([79ba316](https://github.com/langwatch/langwatch/commit/79ba3163c64f224e3d2b640b5340f1503fc57c48))
* tiny alignment fix ([#972](https://github.com/langwatch/langwatch/issues/972)) ([6c20454](https://github.com/langwatch/langwatch/commit/6c20454ecf5a1407cf0f93a9eb211587cba1f7ac))
* use drawer hook fix ([#973](https://github.com/langwatch/langwatch/issues/973)) ([e40aa4b](https://github.com/langwatch/langwatch/commit/e40aa4b71e193f0d4bae766c807626756cf82b0e))


### Miscellaneous

* add agent simulations to the readme ([#961](https://github.com/langwatch/langwatch/issues/961)) ([b3d35e4](https://github.com/langwatch/langwatch/commit/b3d35e4eed7b1c7817ad9e61d677fbdbb3633145))
* **main:** release python-sdk 0.8.0 ([#944](https://github.com/langwatch/langwatch/issues/944)) ([cbfefe9](https://github.com/langwatch/langwatch/commit/cbfefe918dc33ac53503e8e738a77b2dad1b02d1))
* migrate ESLint and Prettier to BiomeJS ([#956](https://github.com/langwatch/langwatch/issues/956)) ([f57199e](https://github.com/langwatch/langwatch/commit/f57199ed742dcd6a9a8838999dc1cf4652316406))


### Code Refactoring

* rename 'copy' to 'replicate' in UI text for cross-project duplication ([#990](https://github.com/langwatch/langwatch/issues/990)) ([e289a11](https://github.com/langwatch/langwatch/commit/e289a111a0037f12a0eda5ca5e8b2189bfdf31e8))

## [1.10.0](https://github.com/langwatch/langwatch/compare/langwatch@v1.9.0...langwatch@v1.10.0) (2025-12-04)


### Features

* add global filters negation ([#888](https://github.com/langwatch/langwatch/issues/888)) ([a332ded](https://github.com/langwatch/langwatch/commit/a332dedc58c4a06d2912c3ec58cf44fccc3d6f29))
* add message deletion to prompt playground chat   ([#855](https://github.com/langwatch/langwatch/issues/855)) ([2a820ee](https://github.com/langwatch/langwatch/commit/2a820ee8bd4e6cdf64c8851fdfdcd13fbfc739ed))
* event sourcing 2, electric boogaloo ([#860](https://github.com/langwatch/langwatch/issues/860)) ([19eeecf](https://github.com/langwatch/langwatch/commit/19eeecfd9c4bec1826c087854a40f5c1f8722351))
* improve trace message loading with retry logic and caching ([#852](https://github.com/langwatch/langwatch/issues/852)) ([4a76815](https://github.com/langwatch/langwatch/commit/4a76815c2b36a5f608f2fc4c97d4f36995db3fcc))


### Bug Fixes

* add cap and no decimal ([#851](https://github.com/langwatch/langwatch/issues/851)) ([e0efafd](https://github.com/langwatch/langwatch/commit/e0efafd540501fa77720f0e1f48fc6ff83556a20))
* add robust FormErrorDisplay component for form validation errors ([#870](https://github.com/langwatch/langwatch/issues/870)) ([c3d50a5](https://github.com/langwatch/langwatch/commit/c3d50a5ca64326a0697068eecf2250cf547da639))
* bump litellm and other dependencies to the latest version to fix bedrock embedding issues ([b522e89](https://github.com/langwatch/langwatch/commit/b522e89eccd91ae0de814e6bdd743bff0da52d04))
* **hotfix:** fix api_key being set breaking bedrock for newer versions of litellm, has_key being set instead of the actual value, and allowing for empty bedrock values to use env vars instead for onprem deployments ([ade0a84](https://github.com/langwatch/langwatch/commit/ade0a84d59426f796de02f0e150c2e8e32c991f6))
* **hotfix:** parse input and output for mastra ([cdb8766](https://github.com/langwatch/langwatch/commit/cdb876685981993ab79713f5cdb009e8dd195348))
* **hotfix:** remove eval usage limits ([7a48498](https://github.com/langwatch/langwatch/commit/7a48498277f1f7c93dbf8db33cbe4b32eff85b11))
* intelligent minmax for model settings so that users dont have to be surprised with a failure ([#859](https://github.com/langwatch/langwatch/issues/859)) ([0b6b498](https://github.com/langwatch/langwatch/commit/0b6b498d88d2ee71c65fe04a9189465bec6e2d8d))
* langwatch/package.json & langwatch/package-lock.json to reduce vulnerabilities ([a9eeb12](https://github.com/langwatch/langwatch/commit/a9eeb12921f5304a193263d46d07e4aa303c293e))
* managed llm providers ([bddfa70](https://github.com/langwatch/langwatch/commit/bddfa70036252b3c4975cad3242b0f2b9bb03017))
* otel trace/span id parsing was not decoding base64 span/trace ids ([#861](https://github.com/langwatch/langwatch/issues/861)) ([19abbac](https://github.com/langwatch/langwatch/commit/19abbacf9b11fe48bc74330ac29ca3e7bd2bf067))
* **prompts:** make maxTokens and temperature optional in form schema ([#913](https://github.com/langwatch/langwatch/issues/913)) ([73a2705](https://github.com/langwatch/langwatch/commit/73a2705a15d85da5b69a40b8938cc832cdeb4d40)), closes [#912](https://github.com/langwatch/langwatch/issues/912)
* **prompts:** make prompts.get throw error instead of returning null/undefined ([#867](https://github.com/langwatch/langwatch/issues/867)) ([9705201](https://github.com/langwatch/langwatch/commit/97052015061f40fc63069c78bb1e702cbf12fa29))
* **python-sdk:** add httpx.ReadTimeout to transient error skip list ([#910](https://github.com/langwatch/langwatch/issues/910)) ([dbdae14](https://github.com/langwatch/langwatch/commit/dbdae1465b5da364aa23097d9d91ff2072ee6d13)), closes [#909](https://github.com/langwatch/langwatch/issues/909)
* resolve LLM config modal value reversion by adding proper format… ([#874](https://github.com/langwatch/langwatch/issues/874)) ([85daeb2](https://github.com/langwatch/langwatch/commit/85daeb250abc729c1687688e6d049cfc18c55390))
* **secutity:** upgrade next from 15.5.4 to 15.5.7 ([#914](https://github.com/langwatch/langwatch/issues/914)) ([a9eeb12](https://github.com/langwatch/langwatch/commit/a9eeb12921f5304a193263d46d07e4aa303c293e))
* type errors ([#872](https://github.com/langwatch/langwatch/issues/872)) ([f1f3333](https://github.com/langwatch/langwatch/commit/f1f3333a2057a0aed04bd6b4c9e50852ea4cb936))


### Miscellaneous

* add better logging for topic clustering ([587861b](https://github.com/langwatch/langwatch/commit/587861b93b91ff07a5b097d6d1013d7a962f08c0))
* add delete confirmation workflow ([#856](https://github.com/langwatch/langwatch/issues/856)) ([a1a50f5](https://github.com/langwatch/langwatch/commit/a1a50f5679cc6fa9b64c2719bf25f32d7f460e8e))
* event sourcing library ([#815](https://github.com/langwatch/langwatch/issues/815)) ([1e327c8](https://github.com/langwatch/langwatch/commit/1e327c88e2313d368c23ddc6e4e503532fda83ad))
* **main:** release python-sdk 0.7.1 ([#881](https://github.com/langwatch/langwatch/issues/881)) ([df09d83](https://github.com/langwatch/langwatch/commit/df09d83b1034b87fb4ca206a0339169d75798d88))
* **main:** release python-sdk 0.7.2 ([#911](https://github.com/langwatch/langwatch/issues/911)) ([7a1e545](https://github.com/langwatch/langwatch/commit/7a1e5451cf87a1d741a7b986edeba2b9fafe7401))
* rework add members modal ([#812](https://github.com/langwatch/langwatch/issues/812)) ([066f197](https://github.com/langwatch/langwatch/commit/066f197220c103fae4048df2fd790a94035ce711))

## [1.9.0](https://github.com/langwatch/langwatch/compare/langwatch@v1.8.0...langwatch@v1.9.0) (2025-11-17)


### Features

* make the prompt playground public ([#831](https://github.com/langwatch/langwatch/issues/831)) ([85f26f5](https://github.com/langwatch/langwatch/commit/85f26f5b89529a17a0edf8b79d57aa9cf82bd0ec))
* span ingestion consume and write to clickhouse ([#814](https://github.com/langwatch/langwatch/issues/814)) ([16cf9f5](https://github.com/langwatch/langwatch/commit/16cf9f506d03fcb69e5ca858af32b2fa0289df14))


### Bug Fixes

* add back copilot css to the page ([#838](https://github.com/langwatch/langwatch/issues/838)) ([3cc1c79](https://github.com/langwatch/langwatch/commit/3cc1c79fa5e01f8da7377fa249e4402363600b9a))
* demo ([#833](https://github.com/langwatch/langwatch/issues/833)) ([049a9b1](https://github.com/langwatch/langwatch/commit/049a9b19c42e860a1bb6e11fa309aa7cb8eaa5d9))
* skip setting default llm if its not needed (e.g. evaluations) to prevent error from default llms even though not being used (e.g. gpt-5 with wrong temperature) ([#834](https://github.com/langwatch/langwatch/issues/834)) ([f59420b](https://github.com/langwatch/langwatch/commit/f59420bc8a67df312166bafbb5aec809d8e9fd2f))


### Miscellaneous

* remove sentry ([#827](https://github.com/langwatch/langwatch/issues/827)) ([2990c98](https://github.com/langwatch/langwatch/commit/2990c98abc8584ebc8b41296114fc8787a885d63))

## [1.8.0](https://github.com/langwatch/langwatch/compare/langwatch@v1.7.0...langwatch@v1.8.0) (2025-11-13)


### Features

* add dataset error visibly to frontend ([#797](https://github.com/langwatch/langwatch/issues/797)) ([6515d54](https://github.com/langwatch/langwatch/commit/6515d54405ee34db79a6004ceb88953626cfe2f5))
* feature flag for clickhouse migration ([#802](https://github.com/langwatch/langwatch/issues/802)) ([8c14b3d](https://github.com/langwatch/langwatch/commit/8c14b3de6d1a590ea256af73812f23632992e645))
* improved observability setup ([#806](https://github.com/langwatch/langwatch/issues/806)) ([7846a76](https://github.com/langwatch/langwatch/commit/7846a76b5d19f74d6151159d11d29435b977049b))
* new span ingestion with producer for ingestion write queue ([#808](https://github.com/langwatch/langwatch/issues/808)) ([29fcf22](https://github.com/langwatch/langwatch/commit/29fcf2220003d7b13673a63f8d6bc1886203e141))
* prompt studio ([#734](https://github.com/langwatch/langwatch/issues/734)) ([3686d50](https://github.com/langwatch/langwatch/commit/3686d50eebb727bb78085b83155e3f2f863b395f))
* **ui:** apply consistent max-width to all prompt studio tabs ([#798](https://github.com/langwatch/langwatch/issues/798)) ([021021d](https://github.com/langwatch/langwatch/commit/021021d121754c8d4fc8a2eccb1e21927484f4dc))
* usage notification ([#805](https://github.com/langwatch/langwatch/issues/805)) ([799925f](https://github.com/langwatch/langwatch/commit/799925f4c849591939a3e47eb2e1ce7c5c02047f))


### Bug Fixes

* convert empty string handles to null ([#800](https://github.com/langwatch/langwatch/issues/800)) ([9829e79](https://github.com/langwatch/langwatch/commit/9829e7921ca554b70f087c8c2afb474cea085971))
* convert empty string handles to null in versionedPromptToPromptConfigFormValues ([9829e79](https://github.com/langwatch/langwatch/commit/9829e7921ca554b70f087c8c2afb474cea085971))
* demo ([#811](https://github.com/langwatch/langwatch/issues/811)) ([562a22e](https://github.com/langwatch/langwatch/commit/562a22ed4690332381b2c7b68193a958741950c0))
* disable auto instruementation of undici to prevent double-setting of traceparent for elastic search clients ([#807](https://github.com/langwatch/langwatch/issues/807)) ([a99cd5f](https://github.com/langwatch/langwatch/commit/a99cd5f35449a578c24169661e9fcac0f4a768be))
* handle corrupted workflow data gracefully with intelligent salvage ([#795](https://github.com/langwatch/langwatch/issues/795)) ([fc967ad](https://github.com/langwatch/langwatch/commit/fc967addbf868a75ffd5788c4f199f4319e8a558))
* **prompt-configs:** hide new conversation button on other tabs ([#794](https://github.com/langwatch/langwatch/issues/794)) ([1e457bf](https://github.com/langwatch/langwatch/commit/1e457bf7c0e02ea699bef4de6797a98cbe1e9cd6))
* **prompt-studio:** prevent zod errors when managing output fields  ([#793](https://github.com/langwatch/langwatch/issues/793)) ([22c7148](https://github.com/langwatch/langwatch/commit/22c7148b1d37460b9c1c76f8d95a585883fa8777))
* **studio:** enforce GPT-5 constraints and normalize LLM config format for DSPy ([#796](https://github.com/langwatch/langwatch/issues/796)) ([f8274cf](https://github.com/langwatch/langwatch/commit/f8274cffa15e7ba486c3c5301c17a9e1dfcbc69f))


### Miscellaneous

* fix otel export url path ([#810](https://github.com/langwatch/langwatch/issues/810)) ([5ab142a](https://github.com/langwatch/langwatch/commit/5ab142a4320d633f548d6db3e259b5897a89e4c2))

## [1.7.0](https://github.com/langwatch/langwatch/compare/langwatch@v1.6.0...langwatch@v1.7.0) (2025-11-07)


### Features

* add password change from settings for email auth ([#789](https://github.com/langwatch/langwatch/issues/789)) ([c91e114](https://github.com/langwatch/langwatch/commit/c91e11458d8f987c327ce99d0ad526addf33c95a))
* added langchain and langgraph to python onboarding + improvements from testing ([#782](https://github.com/langwatch/langwatch/issues/782)) ([99b2f25](https://github.com/langwatch/langwatch/commit/99b2f25654b0c6b440a4680ffe36b37a7579d1d1))
* evaluation and prompt onboarding flows ([#775](https://github.com/langwatch/langwatch/issues/775)) ([094831d](https://github.com/langwatch/langwatch/commit/094831d79444bf435f1d289482ac751a2830b808))


### Bug Fixes

* **langwatch_nlp:** remove unused langchain-community dependency ([9ad61f7](https://github.com/langwatch/langwatch/commit/9ad61f7e2d7ef3e06de27f24adad326b56969f17))
* remove unused langchain-community dependency ([#787](https://github.com/langwatch/langwatch/issues/787)) ([9ad61f7](https://github.com/langwatch/langwatch/commit/9ad61f7e2d7ef3e06de27f24adad326b56969f17))
* simulations page crashing browser ([#784](https://github.com/langwatch/langwatch/issues/784)) ([e731a5f](https://github.com/langwatch/langwatch/commit/e731a5ff366b8bbc497c88888f38b8bfaf690ddb))


### Miscellaneous

* separate the admin override add memebers button so we can see like the users see it ([b6e06d7](https://github.com/langwatch/langwatch/commit/b6e06d75e2b2e6ae83cd790cc18e0fe4f5299404))

## [1.6.0](https://github.com/langwatch/langwatch/compare/langwatch@v1.5.1...langwatch@v1.6.0) (2025-11-05)


### Features

* include workflow name in export filename ([#768](https://github.com/langwatch/langwatch/issues/768)) ([c4397bf](https://github.com/langwatch/langwatch/commit/c4397bf83bf0b24befb98b0d2d1f88673233f575))
* new product onboarding ([#722](https://github.com/langwatch/langwatch/issues/722)) ([5a134fb](https://github.com/langwatch/langwatch/commit/5a134fbd9d68a16203095db74355a9e4a2d67b7a))
* new rbac system ([#724](https://github.com/langwatch/langwatch/issues/724)) ([1cde6d4](https://github.com/langwatch/langwatch/commit/1cde6d4a21e16aee97cead8d025cabd9a31a32c4))
* support langchain/langgraph 1.0.0 in python sdk ([#780](https://github.com/langwatch/langwatch/issues/780)) ([70d4814](https://github.com/langwatch/langwatch/commit/70d4814528465d8e58d1ab4f82849ea13d6f564d))


### Bug Fixes

* api snipper dialog header ([#772](https://github.com/langwatch/langwatch/issues/772)) ([d472065](https://github.com/langwatch/langwatch/commit/d472065312e70953163744c70ce6ac236efdac13))
* grid layout in optimization modal ([#773](https://github.com/langwatch/langwatch/issues/773)) ([e5cd90e](https://github.com/langwatch/langwatch/commit/e5cd90e7baae0bb9c1bbf1992b81f8daa072a302))
* observability onboarding fixes ([#774](https://github.com/langwatch/langwatch/issues/774)) ([422660c](https://github.com/langwatch/langwatch/commit/422660c47b09e0093f4ff211a86ff1a6c2765188))
* onboarding light theme fix ([#771](https://github.com/langwatch/langwatch/issues/771)) ([3f3ec72](https://github.com/langwatch/langwatch/commit/3f3ec72737eb5042016e60fcdda5e32972b86fd3))
* parsing of Long values comming from Strands, add support for gen_ai.server.time_to_first_token ([c060766](https://github.com/langwatch/langwatch/commit/c060766fa093a6c6a881244267c1ed9929c9246b))
* prevent users from removing themselves from the org ([c99ad0b](https://github.com/langwatch/langwatch/commit/c99ad0ba5d5d570a9d018f38ee2dd20e1881305a))
* update guards ([#781](https://github.com/langwatch/langwatch/issues/781)) ([3e9330f](https://github.com/langwatch/langwatch/commit/3e9330f5a1c8fef5ab19a497a4d66494d046a5e0))


### Miscellaneous

* cleanup orphaned hot traces for cold trace migrations that possibly failed in the middle ([9a72dc1](https://github.com/langwatch/langwatch/commit/9a72dc1d3b3980c6f3abf4f294f91b78cd1a46da))
* ignore false-positive an update is in progress errors ([3760b96](https://github.com/langwatch/langwatch/commit/3760b961839e04b565ce5af7d418e1ef09997978))
* refactor model providers logic ([#777](https://github.com/langwatch/langwatch/issues/777)) ([05a8a2b](https://github.com/langwatch/langwatch/commit/05a8a2b2f375878814e72829c6a24f0278e5d414))
* update invite email copy ([#770](https://github.com/langwatch/langwatch/issues/770)) ([e9162d1](https://github.com/langwatch/langwatch/commit/e9162d15f1dc5cded6cdd81464c662eb61dafd5b))

## [1.5.1](https://github.com/langwatch/langwatch/compare/langwatch@v1.5.0...langwatch@v1.5.1) (2025-10-31)


### Bug Fixes

* add missing field for azure-ad sso auth ([34988ea](https://github.com/langwatch/langwatch/commit/34988ea135b44a299da5a8547ad5c1fc7b0e55a1))
* dataset slug name sync ([#759](https://github.com/langwatch/langwatch/issues/759)) ([d9f87e4](https://github.com/langwatch/langwatch/commit/d9f87e4dc4df610e876f931094d3e86f2c5254d1))

## [1.5.0](https://github.com/langwatch/langwatch/compare/langwatch@v1.4.0...langwatch@v1.5.0) (2025-10-31)


### Features

* exporter filter span logic ([#733](https://github.com/langwatch/langwatch/issues/733)) ([0db9b16](https://github.com/langwatch/langwatch/commit/0db9b1629a3a362f37113aaf26a5543b8dee2ead))

## [1.4.0](https://github.com/langwatch/langwatch/compare/langwatch@v1.3.1...langwatch@v1.4.0) (2025-10-31)


### Features

* delete dataset confirmation ([#762](https://github.com/langwatch/langwatch/issues/762)) ([f13366e](https://github.com/langwatch/langwatch/commit/f13366e486dd538fc7dc023f20d26c8a325fe6c7))
* enable cron worker for local dev ([#673](https://github.com/langwatch/langwatch/issues/673)) ([536e9fa](https://github.com/langwatch/langwatch/commit/536e9fa2fe88b86728c2a5bd4394a5b4de5bee4d))
* upgrade to dspy v3 ([9833bbb](https://github.com/langwatch/langwatch/commit/9833bbb2b1e1c210350dbea6c502a8f0e624badc))
* upgrade to DSPy v3 🎉 ([#752](https://github.com/langwatch/langwatch/issues/752)) ([9833bbb](https://github.com/langwatch/langwatch/commit/9833bbb2b1e1c210350dbea6c502a8f0e624badc))


### Bug Fixes

* azure ad extra required permission and env var names ([#764](https://github.com/langwatch/langwatch/issues/764)) ([5bfabd3](https://github.com/langwatch/langwatch/commit/5bfabd381e1aa4c34870fbb7b8357c75fbc87cf1))
* ci failing ([#748](https://github.com/langwatch/langwatch/issues/748)) ([0b25070](https://github.com/langwatch/langwatch/commit/0b250705aea823c50ef27d06852dc8d3a354ad40))
* dataset routes ([#756](https://github.com/langwatch/langwatch/issues/756)) ([da736e0](https://github.com/langwatch/langwatch/commit/da736e025280208ceed620cd1bb8c43366120f0e))
* error handling ([#747](https://github.com/langwatch/langwatch/issues/747)) ([732a7ef](https://github.com/langwatch/langwatch/commit/732a7ef0520b58ef44ec716831110d5f61d8edd7))
* ignore 'Function already exist' lambda errors due to race conditions and use existing lambda ([c7b7787](https://github.com/langwatch/langwatch/commit/c7b77876e0f9d64edda0de2d698e65af0d50770b))
* integration tests for typescript sdk ([#757](https://github.com/langwatch/langwatch/issues/757)) ([bfd79bb](https://github.com/langwatch/langwatch/commit/bfd79bbdbcb00668720709bf53789aceb79b0466))
* mermaid sequence diagram sanitization for tricky span names ([cae4077](https://github.com/langwatch/langwatch/commit/cae4077ebd3913ce2cde6a60be0846b157f0d8a7))
* **next.js-15:** Register NodeTracerProvider globally when ProxyTracerProvider detected ([87c1f1f](https://github.com/langwatch/langwatch/commit/87c1f1fd890b89c64ecf39997d5236dc506dd3cf))
* register NodeTracerProvider globally when ProxyTracerProvider detected ([#754](https://github.com/langwatch/langwatch/issues/754)) ([87c1f1f](https://github.com/langwatch/langwatch/commit/87c1f1fd890b89c64ecf39997d5236dc506dd3cf))
* rerendering loop issues on component type workflows on the studio ([8225238](https://github.com/langwatch/langwatch/commit/82252381637a50d490e905d3cde68e5041cebcae))


### Miscellaneous

* bump typescript sdk to v0.7.4 ([#755](https://github.com/langwatch/langwatch/issues/755)) ([697792c](https://github.com/langwatch/langwatch/commit/697792cc9242e31c091adbf18c37aca305b9a21d))
* temp disable e2e tests for typescript sdk ([#758](https://github.com/langwatch/langwatch/issues/758)) ([21376dc](https://github.com/langwatch/langwatch/commit/21376dcc48e7871e61fcaa02d54ae55b854be5aa))

## [1.3.1](https://github.com/langwatch/langwatch/compare/langwatch@v1.3.0...langwatch@v1.3.1) (2025-10-27)


### Bug Fixes

* azure ai gateway for azure OpenAI ([#744](https://github.com/langwatch/langwatch/issues/744)) ([5dc7953](https://github.com/langwatch/langwatch/commit/5dc79539049c32153e49790650dcac6bfb0317e5))
* double indicator issue ([#738](https://github.com/langwatch/langwatch/issues/738)) ([4936071](https://github.com/langwatch/langwatch/commit/493607172b53fd034b6a94a77ee7927556a0fbfb))

## [1.3.0](https://github.com/langwatch/langwatch/compare/langwatch@v1.2.0...langwatch@v1.3.0) (2025-10-24)


### Features

* add threads to traces on dataset select ([#735](https://github.com/langwatch/langwatch/issues/735)) ([e5e1ead](https://github.com/langwatch/langwatch/commit/e5e1ead3d3b4e98b2ae058b6e90ab4b0a087ce86))
* add threads to traces on dataset select ([#735](https://github.com/langwatch/langwatch/issues/735)) ([82ee55e](https://github.com/langwatch/langwatch/commit/82ee55e1b929aca4e7b77cf4ad4843ff22055f2d))
* allow to skip migrations during startup ([#731](https://github.com/langwatch/langwatch/issues/731)) ([73f41bc](https://github.com/langwatch/langwatch/commit/73f41bc045a37bd6ebb6e958a3c7d020f624d01e))
* custom headers ([#740](https://github.com/langwatch/langwatch/issues/740)) ([c36e5a7](https://github.com/langwatch/langwatch/commit/c36e5a7e7e517d6b63567080923be6107303ed57))


### Bug Fixes

* cold index detection for opensearch used in annotations ([#737](https://github.com/langwatch/langwatch/issues/737)) ([134379e](https://github.com/langwatch/langwatch/commit/134379ee8fdda54d68c4e180f37f1350a141c668))
* mapping state is nullable, fallback to default mappings for trace evaluations ([#736](https://github.com/langwatch/langwatch/issues/736)) ([e5e1ead](https://github.com/langwatch/langwatch/commit/e5e1ead3d3b4e98b2ae058b6e90ab4b0a087ce86))
* rare race condition where trace is picked up right at the moment where we are trying to merge it by deleting + rescheduling with spans grouped AND fallback to sync if scheduling fails completely ([#739](https://github.com/langwatch/langwatch/issues/739)) ([d8a7d4c](https://github.com/langwatch/langwatch/commit/d8a7d4c9d985eb28201e467817d082d1eef1689b))


### Miscellaneous

* add span count and weight details for better debugging of immense traces ([2be915e](https://github.com/langwatch/langwatch/commit/2be915e1735c0632caac8d8082f632d461643967))

## [1.2.0](https://github.com/langwatch/langwatch/compare/langwatch@v1.1.1...langwatch@v1.2.0) (2025-10-18)


### Features

* add filters on series for custom graphs ([#705](https://github.com/langwatch/langwatch/issues/705)) ([b200586](https://github.com/langwatch/langwatch/commit/b2005860b7ef1637bcb050ec45c03e0c92bba37e))
* add percentage to series ([#709](https://github.com/langwatch/langwatch/issues/709)) ([c6e63df](https://github.com/langwatch/langwatch/commit/c6e63df26f5bdb84e84e524ba2be9361bd7285e9))
* added automatic country detection to phone input ([#714](https://github.com/langwatch/langwatch/issues/714)) ([82d3fe0](https://github.com/langwatch/langwatch/commit/82d3fe0eafcffbbec0912dcd57d5dae3c3dc9b53))
* new onboarding flow ([#686](https://github.com/langwatch/langwatch/issues/686)) ([26d9c8d](https://github.com/langwatch/langwatch/commit/26d9c8dc55e7bc2a1e39327e26fab894197532fb))


### Bug Fixes

* failing go test with gpt5 update ([bc16d63](https://github.com/langwatch/langwatch/commit/bc16d63ad65f1fcf28077914d2f9d0d9b3cd0c53))
* onboarding types to align with crm ([#727](https://github.com/langwatch/langwatch/issues/727)) ([8b7f9b2](https://github.com/langwatch/langwatch/commit/8b7f9b2b42723d056b6a220b162cfb6c16822805))
* refactor to stop re-rendering causing input focus mayhem ([#729](https://github.com/langwatch/langwatch/issues/729)) ([9981533](https://github.com/langwatch/langwatch/commit/99815339e4d50fd339a25da28d4adda7bb1e3cb0))
* release please was broken ([4e09652](https://github.com/langwatch/langwatch/commit/4e09652c3e92471b2cc00de3c8913449319a371b))
* release please was broken with missing permissions ([#723](https://github.com/langwatch/langwatch/issues/723)) ([4e09652](https://github.com/langwatch/langwatch/commit/4e09652c3e92471b2cc00de3c8913449319a371b))
* remove usage stats log ([#725](https://github.com/langwatch/langwatch/issues/725)) ([f113b0c](https://github.com/langwatch/langwatch/commit/f113b0ca3777e3a35fba2241e4fbc8692f61d3e6))
* type errors in langwatch app ([#716](https://github.com/langwatch/langwatch/issues/716)) ([f6cc1c8](https://github.com/langwatch/langwatch/commit/f6cc1c8a1eb9abc4310d673cc2056c8d0fb11859))
* updates for release please ([#711](https://github.com/langwatch/langwatch/issues/711)) ([d88597c](https://github.com/langwatch/langwatch/commit/d88597c203e6aefcb07c135f2e6fb5553ef9b4ac))


### Miscellaneous

* added onboarding signout button ([#721](https://github.com/langwatch/langwatch/issues/721)) ([2741e96](https://github.com/langwatch/langwatch/commit/2741e96f52fac4d7f72878ff31b7f2cf13f44242))
* new onboarding analytics ([#720](https://github.com/langwatch/langwatch/issues/720)) ([af4ebf0](https://github.com/langwatch/langwatch/commit/af4ebf0d207be875780fbc1ece53caebfbbe86f1))
* refactor onboarding component structure ([#715](https://github.com/langwatch/langwatch/issues/715)) ([3900c1b](https://github.com/langwatch/langwatch/commit/3900c1b75197dfedb5c882caf9d120112b906e85))
* use release specific token ([#717](https://github.com/langwatch/langwatch/issues/717)) ([c8acb69](https://github.com/langwatch/langwatch/commit/c8acb69e948564407bdfb248c3690bc5f64523de))

## [1.1.1](https://github.com/langwatch/langwatch/compare/langwatch@v1.1.0...langwatch@v1.1.1) (2025-10-13)


### Bug Fixes

* add bodyparser limit to all otel inbound endpoints ([#707](https://github.com/langwatch/langwatch/issues/707)) ([d9ce8bb](https://github.com/langwatch/langwatch/commit/d9ce8bb107298c62e0debcdb0ba17c7936ccf872))
* find local prompt ([#700](https://github.com/langwatch/langwatch/issues/700)) ([ab42400](https://github.com/langwatch/langwatch/commit/ab42400dea353dd72f5be66004f0cb9a11f2e7d2))
* improve performance on evaluations table with virtualized grid ([#701](https://github.com/langwatch/langwatch/issues/701)) ([b5eb7d1](https://github.com/langwatch/langwatch/commit/b5eb7d1f67d50e1fc2b04ad46e4f1a7e316c2d7a))
* reduce cache count to 5 min to avoid blowups, and move histograms to common place ([589797d](https://github.com/langwatch/langwatch/commit/589797d097418e4fc0f3b77ef82a65199c926bcc))

## [1.1.0](https://github.com/langwatch/langwatch/compare/langwatch@v1.0.0...langwatch@v1.1.0) (2025-10-13)


### Features

* add support for otel /metrics endpoint for genai metrics ([#680](https://github.com/langwatch/langwatch/issues/680)) ([14bec0d](https://github.com/langwatch/langwatch/commit/14bec0d70d4c645d409b2b18a8f6219515563aed))
* add thread evals ([#677](https://github.com/langwatch/langwatch/issues/677)) ([e89700b](https://github.com/langwatch/langwatch/commit/e89700b71dda46e29c13f03a5fae88add852c9fb))


### Bug Fixes

* ai data generation ([#693](https://github.com/langwatch/langwatch/issues/693)) ([9316a13](https://github.com/langwatch/langwatch/commit/9316a1321c38dc93da5c9fadbe883e2b3ebd24ff))
* better message fall back ([#689](https://github.com/langwatch/langwatch/issues/689)) ([c97324e](https://github.com/langwatch/langwatch/commit/c97324eada433947e543bef3273692f7aa60d1e6))
* bug when saving prompt ([#684](https://github.com/langwatch/langwatch/issues/684)) ([ff13d1d](https://github.com/langwatch/langwatch/commit/ff13d1dab36eeaa461ddde4be976882fd97c806c))
* custom report layout smaller screen ([#694](https://github.com/langwatch/langwatch/issues/694)) ([8ed0882](https://github.com/langwatch/langwatch/commit/8ed08823f8f74a188a97d2678f339b0fc0e5e6d2))
* invite code ([#683](https://github.com/langwatch/langwatch/issues/683)) ([aee5fad](https://github.com/langwatch/langwatch/commit/aee5fad78e93bea7e4060684dedaf628ae5b9901))
* mapping layout evals ([#688](https://github.com/langwatch/langwatch/issues/688)) ([a7aaab5](https://github.com/langwatch/langwatch/commit/a7aaab56944b1be2e17c520a6e983e4cb56fdda5))
* no need for loading stat here, dialog shows it ([#691](https://github.com/langwatch/langwatch/issues/691)) ([4e175f0](https://github.com/langwatch/langwatch/commit/4e175f0826bc164e7ca5ba4e1fc5588beb66264e))
* sort disabled bottom ([#692](https://github.com/langwatch/langwatch/issues/692)) ([9bd4a09](https://github.com/langwatch/langwatch/commit/9bd4a09a6bf169487b1f988e17e18d0680ebd82d))
* sort scenario sets by last run date ([#682](https://github.com/langwatch/langwatch/issues/682)) ([3b0e804](https://github.com/langwatch/langwatch/commit/3b0e80432e42b25e5b3168bb4cc9d3d87b8af72e))
* use bitnami legacy images for helm chart ([#681](https://github.com/langwatch/langwatch/issues/681)) ([cf30957](https://github.com/langwatch/langwatch/commit/cf3095747d00993622e44aa0d200f5106e0d83c6))
* use correct value for pulling legacy bitnami prometheus chart ([#687](https://github.com/langwatch/langwatch/issues/687)) ([4d7776c](https://github.com/langwatch/langwatch/commit/4d7776c458c0d7db721f7aaced7b717581130ce2))
* use prompt handler on the prompt api snippet ([#690](https://github.com/langwatch/langwatch/issues/690)) ([ce6f9bb](https://github.com/langwatch/langwatch/commit/ce6f9bbd8fdea57f4be372abbfd645deb80a1daf))
* zod dynamic form with prefix, to fix changing the llm as a judge categories ([#685](https://github.com/langwatch/langwatch/issues/685)) ([f8ca777](https://github.com/langwatch/langwatch/commit/f8ca7774d6a15ac6d028656597f76369d113974a))


### Miscellaneous

* update to allow first_token_ms ([#702](https://github.com/langwatch/langwatch/issues/702)) ([38ffd34](https://github.com/langwatch/langwatch/commit/38ffd34f90e49c866690747c0e36b43a867cc698))
* update version 0.5 ([#704](https://github.com/langwatch/langwatch/issues/704)) ([615510f](https://github.com/langwatch/langwatch/commit/615510fa04ebe3c33635d0edcd3e8f7faeaabb52))


### Code Refactoring

* prompts ([#674](https://github.com/langwatch/langwatch/issues/674)) ([8eaf4ff](https://github.com/langwatch/langwatch/commit/8eaf4ffff6e4a22445da4a0577a08c6d7bf57124))

## [0.2.0](https://github.com/langwatch/langwatch/compare/langwatch@v0.1.34...langwatch@v0.2.0) (2025-10-02)


### Features

* action to add complete thread to dataset at once ([#546](https://github.com/langwatch/langwatch/issues/546)) ([24a27ad](https://github.com/langwatch/langwatch/commit/24a27add47ee89b93374b937bd8bb9fb3fe68b49))
* add 'message' key extraction to heuristics ([6b7bc9d](https://github.com/langwatch/langwatch/commit/6b7bc9d9a2b45a384373e601f1a8119c9c02d9ea))
* add ability to delete project ([#590](https://github.com/langwatch/langwatch/issues/590)) ([6741f81](https://github.com/langwatch/langwatch/commit/6741f8183294c7815d5ffaab1d03fede00bfe4e0))
* add auth providers ([#490](https://github.com/langwatch/langwatch/issues/490)) ([93b4063](https://github.com/langwatch/langwatch/commit/93b406352d8c583f0974f146e3b99305c60c56b7))
* add check for required sso login ([#657](https://github.com/langwatch/langwatch/issues/657)) ([bff7cbc](https://github.com/langwatch/langwatch/commit/bff7cbc1255f2e0b889c4ce9fd4a16c723a36dac))
* add cold storage for older traces ([307eef4](https://github.com/langwatch/langwatch/commit/307eef4ae83e7547c7da93b42239d48d325fd8cf))
* add crewai open telemetry  ([#549](https://github.com/langwatch/langwatch/issues/549)) ([e47bc67](https://github.com/langwatch/langwatch/commit/e47bc67135cc6019ddc67a89d610b92a81ed2c10))
* add filters to custom graphs ([#483](https://github.com/langwatch/langwatch/issues/483)) ([974ff9f](https://github.com/langwatch/langwatch/commit/974ff9fdb054fc6286f776ea71ea3961cea7743c))
* add frill integration ([#462](https://github.com/langwatch/langwatch/issues/462)) ([3b1f3d0](https://github.com/langwatch/langwatch/commit/3b1f3d03a0ef9821f3fbf08607c0177bbeac3ddc))
* add hours markers on the graphs for smaller periods ([#394](https://github.com/langwatch/langwatch/issues/394)) ([a9b2bc4](https://github.com/langwatch/langwatch/commit/a9b2bc4a2da2371475235435848e588606aa91d1))
* add image viewing dataset ([#620](https://github.com/langwatch/langwatch/issues/620)) ([0aa5bcf](https://github.com/langwatch/langwatch/commit/0aa5bcf51aacff01a20e555049c3e0e67f9de758))
* Add ingress to helm chart ([#385](https://github.com/langwatch/langwatch/issues/385)) ([34f2f45](https://github.com/langwatch/langwatch/commit/34f2f4578191c5faa2f112bf89fec827c02cfee6))
* add langwatch docker images to release-please ([e9f98b7](https://github.com/langwatch/langwatch/commit/e9f98b7253ba82fd79c5b10468cd68fee6f363e1))
* add leaf node durations to sequence diagram ([14f281b](https://github.com/langwatch/langwatch/commit/14f281b1d4ec30bf6464705e8b7906e8cf65d574))
* add manual topic clustering and better input extraction ([#668](https://github.com/langwatch/langwatch/issues/668)) ([29730f0](https://github.com/langwatch/langwatch/commit/29730f00c1c3a868b361578e3c30cf03bcc1acee))
* add members signup ([#642](https://github.com/langwatch/langwatch/issues/642)) ([5e3706d](https://github.com/langwatch/langwatch/commit/5e3706d92840e1bdecaa2f870b6d6f02c1924c6a))
* add pagination to scenario ([#569](https://github.com/langwatch/langwatch/issues/569)) ([75048f1](https://github.com/langwatch/langwatch/commit/75048f1fa7e75f8c963fbf5f1842a199ef285055))
* add prometheus to helm charts ([#501](https://github.com/langwatch/langwatch/issues/501)) ([45a4297](https://github.com/langwatch/langwatch/commit/45a4297f3ce85858cf3b737ad1b8923f8510eeeb))
* add release-please to mcp-server ([#647](https://github.com/langwatch/langwatch/issues/647)) ([1839f41](https://github.com/langwatch/langwatch/commit/1839f418466c60effa7faf71f5617448f993d160))
* add scenario analytics ([#469](https://github.com/langwatch/langwatch/issues/469)) ([8fe1486](https://github.com/langwatch/langwatch/commit/8fe14867326fb2cf01c5a1bc8ff5bfe190257c89))
* add scenario to usage stats ([#471](https://github.com/langwatch/langwatch/issues/471)) ([d036e56](https://github.com/langwatch/langwatch/commit/d036e569756dfc7c165c6b7ef640a7d60f201283))
* add support for azure api gateway ([#641](https://github.com/langwatch/langwatch/issues/641)) ([d66495e](https://github.com/langwatch/langwatch/commit/d66495ecb3b915c4b7b03704b4640860ea51f982))
* add trace usage to dashboard and usage page ([#498](https://github.com/langwatch/langwatch/issues/498)) ([9d26e79](https://github.com/langwatch/langwatch/commit/9d26e796562b8e8a13d96202ded67050ab7b989d))
* add vpc security groups to the dynamic lambda for better access control ([9878f7e](https://github.com/langwatch/langwatch/commit/9878f7ed223da0384fc3b254ec13974a06723d23))
* add xai cerebras ([#670](https://github.com/langwatch/langwatch/issues/670)) ([b069fa8](https://github.com/langwatch/langwatch/commit/b069fa865c4ce8e50031a0d69a52b76ed3158401))
* added auto setup functionality for langwatch mcp ([#617](https://github.com/langwatch/langwatch/issues/617)) ([8c95b07](https://github.com/langwatch/langwatch/commit/8c95b07598a74285940b0c9267368543a9ced5e0))
* allow admins to turn off trace sharing per project ([#585](https://github.com/langwatch/langwatch/issues/585)) ([1f575d0](https://github.com/langwatch/langwatch/commit/1f575d0f1a1650d16bf3b25a10204365e7dc69c0))
* allow pasting of comma separated models ([#586](https://github.com/langwatch/langwatch/issues/586)) ([eb0761d](https://github.com/langwatch/langwatch/commit/eb0761d13072945df78a108710f8614238d7bb04))
* allow to archive team ([#602](https://github.com/langwatch/langwatch/issues/602)) ([97ca118](https://github.com/langwatch/langwatch/commit/97ca11804c172c0d1b36e0662ff2eaf630e558be))
* allow to export sequence mermaid diagram ([fc82092](https://github.com/langwatch/langwatch/commit/fc82092693e0c296cb7d4b4abcf3c2f449048773))
* allow to set the run_id manually ([93417de](https://github.com/langwatch/langwatch/commit/93417de88e4115bf63edf8b83976d0ffd98954a4))
* allow to track dspy evaluators as well (by @WSJUSA) ([#488](https://github.com/langwatch/langwatch/issues/488)) ([1b79275](https://github.com/langwatch/langwatch/commit/1b792750000fdc2295962699823ae24a3ec0354c))
* analytics table ([#441](https://github.com/langwatch/langwatch/issues/441)) ([e100c61](https://github.com/langwatch/langwatch/commit/e100c6144660c0588d34fad3eb87ae7b92aa8de7))
* bump it all from gpt-4o-mini to gpt-5 ([e2fb8bb](https://github.com/langwatch/langwatch/commit/e2fb8bb95048807b4a9d5713d41e6559e72da012))
* ci/cd steps for all packages and deployables, including improvements to caching and bundle sizes ([#351](https://github.com/langwatch/langwatch/issues/351)) ([e67a169](https://github.com/langwatch/langwatch/commit/e67a1694fec2f96479266454403928e9dc68a20f))
* click to prompt filter new page LWH-1091 ([#514](https://github.com/langwatch/langwatch/issues/514)) ([62455ce](https://github.com/langwatch/langwatch/commit/62455cea72473b74f0b0856a745f6cb33552d49e))
* create a lambda per project ([#420](https://github.com/langwatch/langwatch/issues/420)) ([c8b25be](https://github.com/langwatch/langwatch/commit/c8b25beeb6961dfd38de1e9d04412a15b63fdb2f))
* download tiktokens from repository ([#410](https://github.com/langwatch/langwatch/issues/410)) ([ce68c38](https://github.com/langwatch/langwatch/commit/ce68c38c32209aa005e697942b64cbda08985e70))
* expand prompts support in python sdk ([#540](https://github.com/langwatch/langwatch/issues/540)) ([f7cd8b2](https://github.com/langwatch/langwatch/commit/f7cd8b233258df270a0f383052a4349b587e8b8d))
* get rid of websockets entirely, use SSE only for more reliability ([668aca9](https://github.com/langwatch/langwatch/commit/668aca98f5cdc34d2a5118c393b7e2bb3f3036a0))
* guaranteed availability ([#630](https://github.com/langwatch/langwatch/issues/630)) ([d4d3f55](https://github.com/langwatch/langwatch/commit/d4d3f553daaeaba1d3576141f40fc182ef2b21bf))
* guaranteed availability python ([#633](https://github.com/langwatch/langwatch/issues/633)) ([1818542](https://github.com/langwatch/langwatch/commit/1818542bdacced509a66465c5641f33572fafe3c))
* implement sequence diagram for agents and tool calls based on the trace ([#666](https://github.com/langwatch/langwatch/issues/666)) ([ce159ca](https://github.com/langwatch/langwatch/commit/ce159ca4cc967810836992a81583ad1ca81c6fc2))
* improve helm chart ([#608](https://github.com/langwatch/langwatch/issues/608)) ([699b8f0](https://github.com/langwatch/langwatch/commit/699b8f0a9ce3b05058141f00281a5b68f9874978))
* improve ingestion of strands traces ([#589](https://github.com/langwatch/langwatch/issues/589)) ([7d05c9b](https://github.com/langwatch/langwatch/commit/7d05c9ba4cc3ec0b2ccd6b61e130350b2c0b8df9))
* improve langwatch helm chart ([#576](https://github.com/langwatch/langwatch/issues/576)) ([41312a3](https://github.com/langwatch/langwatch/commit/41312a37c8833ac4f5d16db62b11fdcfa0eb9445))
* langwatch go sdk & otelopenai instrumentation ([#340](https://github.com/langwatch/langwatch/issues/340)) ([fd9c4ee](https://github.com/langwatch/langwatch/commit/fd9c4ee9fb98ade8352b20cd7fef124e94969688))
* make set id more prominent on card ([#446](https://github.com/langwatch/langwatch/issues/446)) ([d62f9f8](https://github.com/langwatch/langwatch/commit/d62f9f8856973697c1126e166448f72d07560b77))
* move to cold storage earlier as it's still pretty fast on ES ([3d57185](https://github.com/langwatch/langwatch/commit/3d571850331ef39febd1de426b73c840aa67aa78))
* new open-telemetry based typescript sdk ([#500](https://github.com/langwatch/langwatch/issues/500)) ([7636d4c](https://github.com/langwatch/langwatch/commit/7636d4c0d2601a52ed597fb16ab4e7ff3c4f5fce))
* open trace for each simulation message ([#582](https://github.com/langwatch/langwatch/issues/582)) ([9dfd3c4](https://github.com/langwatch/langwatch/commit/9dfd3c40b0490386a51d252aa7e8a533100632d0))
* process claude code otel logs ([2beb6d9](https://github.com/langwatch/langwatch/commit/2beb6d9fb5fe3873644ab05c6f10b697c8a891a4))
* prompt cli ([#524](https://github.com/langwatch/langwatch/issues/524)) ([aeaddc5](https://github.com/langwatch/langwatch/commit/aeaddc5de91db96643ef1e31077b255b3a696234))
* prompt handle UI ([#516](https://github.com/langwatch/langwatch/issues/516)) ([d812ed9](https://github.com/langwatch/langwatch/commit/d812ed92601b3114bd53cd90ba37f0d9a58d8bf7))
* prompt ids first class filter ([#510](https://github.com/langwatch/langwatch/issues/510)) ([13c6877](https://github.com/langwatch/langwatch/commit/13c6877fa9ba3068b70408126fb9b2beb1cfb2aa))
* prompt references (DB + API) ([#515](https://github.com/langwatch/langwatch/issues/515)) ([3a557a8](https://github.com/langwatch/langwatch/commit/3a557a8fc5528f77f7320e70d5e707e972076512))
* python sdk tracing improvements ([#572](https://github.com/langwatch/langwatch/issues/572)) ([8448ed1](https://github.com/langwatch/langwatch/commit/8448ed1facebfffd367f3105f816bb985a2ffcef))
* redesign typescript sdk ([#529](https://github.com/langwatch/langwatch/issues/529)) ([dc9637d](https://github.com/langwatch/langwatch/commit/dc9637dbb51ecd24b2714711c8c413df77cc0b0f))
* refresh the design of the project welcome screen, and improve some scenarios ux points ([#447](https://github.com/langwatch/langwatch/issues/447)) ([0a64724](https://github.com/langwatch/langwatch/commit/0a64724476831a60250a51936c6d24298c25ab90))
* render image url when inside markdown format for evals v2 ([9a3f4b7](https://github.com/langwatch/langwatch/commit/9a3f4b7d99cec96ca2c6378c5ae1e67c515dfa9a))
* render tool calls ([062797a](https://github.com/langwatch/langwatch/commit/062797a00c19be4ccabc92df3e62196ba06f1efd))
* reset output panel when changing prompts ([#493](https://github.com/langwatch/langwatch/issues/493)) ([19d84f3](https://github.com/langwatch/langwatch/commit/19d84f3e8d48d3782b9136485d62c335f047636f))
* reveal agent simulations in the main menu ([#448](https://github.com/langwatch/langwatch/issues/448)) ([950d7be](https://github.com/langwatch/langwatch/commit/950d7bee04f661e97cfa53904206f95f2d2ae4cf))
* rework annotations ([#449](https://github.com/langwatch/langwatch/issues/449)) ([111ae81](https://github.com/langwatch/langwatch/commit/111ae819aa5d186572f3661e9d256a4d81c20e17))
* rework annotations ([#451](https://github.com/langwatch/langwatch/issues/451)) ([121a4a4](https://github.com/langwatch/langwatch/commit/121a4a4fd35c962f57727061b0bc6f75c3cd1c5d))
* scenarios - update in progress console ([#507](https://github.com/langwatch/langwatch/issues/507)) ([2e86677](https://github.com/langwatch/langwatch/commit/2e8667798b5c35bf75091c073492508147181889))
* setup and added basic open-telemetry to the nextjs app and workers and upgrade to vercel ai v5 ([#559](https://github.com/langwatch/langwatch/issues/559)) ([29041d6](https://github.com/langwatch/langwatch/commit/29041d66e5ae33f4ea174d366590a199e8fb42ec))
* ship new typescript sdk ([#523](https://github.com/langwatch/langwatch/issues/523)) ([ff17340](https://github.com/langwatch/langwatch/commit/ff173402e602b6b176fd75a6c5d3391f2a1c947c))
* show copyable prompt id and metadata ([#492](https://github.com/langwatch/langwatch/issues/492)) ([0de5fdb](https://github.com/langwatch/langwatch/commit/0de5fdb65478181d69d9fff72d533a3b89535556))
* show error stack when present ([#511](https://github.com/langwatch/langwatch/issues/511)) ([c9295e9](https://github.com/langwatch/langwatch/commit/c9295e9cfb7e6776f1a52649de4709ca3d51502a))
* show sdk for python snippet ([79301d6](https://github.com/langwatch/langwatch/commit/79301d6eb3b44c13006c8f60f9d8a7981d6d4f16))
* show sdk for python snippet with docs link ([#494](https://github.com/langwatch/langwatch/issues/494)) ([79301d6](https://github.com/langwatch/langwatch/commit/79301d6eb3b44c13006c8f60f9d8a7981d6d4f16))
* signup tracking ([#479](https://github.com/langwatch/langwatch/issues/479)) ([128b7fa](https://github.com/langwatch/langwatch/commit/128b7fab2204ebb41756874275bd53ba580dfadb))
* simulations frontend ([#431](https://github.com/langwatch/langwatch/issues/431)) ([cb0bf0b](https://github.com/langwatch/langwatch/commit/cb0bf0b3e6ccb419bf55cf566f9dce907676e33d))
* support creating prompt version with prompt ([#525](https://github.com/langwatch/langwatch/issues/525)) ([b475c81](https://github.com/langwatch/langwatch/commit/b475c81614f07ac90217027de2a57949d46a135a))
* support events via log records with otel collector ([#428](https://github.com/langwatch/langwatch/issues/428)) ([dc7c6ca](https://github.com/langwatch/langwatch/commit/dc7c6ca423f0d41b961d6b46656eed06391e76b2))
* support getting prompt with version number in python sdk ([#563](https://github.com/langwatch/langwatch/issues/563)) ([119cc2b](https://github.com/langwatch/langwatch/commit/119cc2bff3e232d9e0ec3f0c36c9ebd2a63967e7))
* support strands agents `gen_ai` span events ([#532](https://github.com/langwatch/langwatch/issues/532)) ([ddd69b6](https://github.com/langwatch/langwatch/commit/ddd69b64d948a7b595f7a4596d6f5260fd73892f))
* thread mapping ([#675](https://github.com/langwatch/langwatch/issues/675)) ([33bc70c](https://github.com/langwatch/langwatch/commit/33bc70c1e5174b02f15c74fa08d927a03cd72484))
* tracing of claude code via opentelemetry logs ([#665](https://github.com/langwatch/langwatch/issues/665)) ([2beb6d9](https://github.com/langwatch/langwatch/commit/2beb6d9fb5fe3873644ab05c6f10b697c8a891a4))
* update footer menu ([#499](https://github.com/langwatch/langwatch/issues/499)) ([85be4c7](https://github.com/langwatch/langwatch/commit/85be4c70939d36e5ac97a324cf3ee6865137487c))
* update prompt snippets ([#504](https://github.com/langwatch/langwatch/issues/504)) ([5c91236](https://github.com/langwatch/langwatch/commit/5c91236093523aef9a469694573f53654f22aec6))
* updates to prompt sdk ([#530](https://github.com/langwatch/langwatch/issues/530)) ([492d269](https://github.com/langwatch/langwatch/commit/492d269192ce6c528f46856b57a3498d2b35c8b1))
* use query param for prompt id selection ([#491](https://github.com/langwatch/langwatch/issues/491)) ([626aafc](https://github.com/langwatch/langwatch/commit/626aafc3b877827b12cd8e9b52fe8c2d35d3e01f))
* workflow get dataset from api ([#405](https://github.com/langwatch/langwatch/issues/405)) ([705d3f1](https://github.com/langwatch/langwatch/commit/705d3f1a65fa4a8f462434a8f5ea1084b97aff16))


### Bug Fixes

* [revert] make the merging of spans created by log records and normal spans more intelligent ([#562](https://github.com/langwatch/langwatch/issues/562)) ([97f499d](https://github.com/langwatch/langwatch/commit/97f499dfe76b211d2cbc41b4ade4de864c23327a))
* actually fix CoT ([#473](https://github.com/langwatch/langwatch/issues/473)) ([48bc852](https://github.com/langwatch/langwatch/commit/48bc852d68af500cd559627402219f20ed046e6e))
* add 501s for logs and metrics in case of accidental otel connection to langwatch ([3dfb56e](https://github.com/langwatch/langwatch/commit/3dfb56e0b7f9309b76b889f3ae8123c19376a9a8))
* add batching to scenario look ups ([#568](https://github.com/langwatch/langwatch/issues/568)) ([bb0abf9](https://github.com/langwatch/langwatch/commit/bb0abf9541e0fcf0521cf4feeb67372c49d86dfa))
* add db schema back to the helm chart ([#599](https://github.com/langwatch/langwatch/issues/599)) ([2b78fc4](https://github.com/langwatch/langwatch/commit/2b78fc42452b16ee74c44ad457c0e66c7f79d873))
* add missing dependency for langwatch ([93b66cc](https://github.com/langwatch/langwatch/commit/93b66cc466c669bc08ddb3ceeda829f6cd79cbad))
* add missing dotenv dependency for running tests ([fb706ce](https://github.com/langwatch/langwatch/commit/fb706ceef9a298d070b264ad8b6da7c2df5e2a5d))
* add provider messages ([#664](https://github.com/langwatch/langwatch/issues/664)) ([d720ad4](https://github.com/langwatch/langwatch/commit/d720ad4d9949724dec7ad0bcb5aeae7e12c621e3))
* add pyyaml as dep ([#648](https://github.com/langwatch/langwatch/issues/648)) ([083f7bd](https://github.com/langwatch/langwatch/commit/083f7bd8acdaffc1480c3b77c7afe9ec09b04389))
* add repo chart in ci ([#597](https://github.com/langwatch/langwatch/issues/597)) ([8aa23bf](https://github.com/langwatch/langwatch/commit/8aa23bf115af8c3f7b6ece8f6f6f8bb05833fcce))
* add setting to batch evals ([#551](https://github.com/langwatch/langwatch/issues/551)) ([0b2cff6](https://github.com/langwatch/langwatch/commit/0b2cff6bcbd4edbf5e2485217d8cc6d92bca5087))
* add spans to total cost ([#461](https://github.com/langwatch/langwatch/issues/461)) ([674bfd5](https://github.com/langwatch/langwatch/commit/674bfd5b27d508a3b0a5706a28de02599b972dbe))
* add to dataset would stay loading if trace was not in a thread ([#555](https://github.com/langwatch/langwatch/issues/555)) ([d7c3dd3](https://github.com/langwatch/langwatch/commit/d7c3dd32ec290839ab10019fa69cd155bd9a1238))
* add type fix ([#486](https://github.com/langwatch/langwatch/issues/486)) ([796408b](https://github.com/langwatch/langwatch/commit/796408bf810c62823dcd064527d598dc134474a2))
* adjust redis cluster configuration ([#395](https://github.com/langwatch/langwatch/issues/395)) ([b1cb008](https://github.com/langwatch/langwatch/commit/b1cb00811e547b50a6d1dea40766b28b0b56ac74))
* allow demo project ([#601](https://github.com/langwatch/langwatch/issues/601)) ([13daa5e](https://github.com/langwatch/langwatch/commit/13daa5e3dbb08a2768997552597a8ca90e2fa5e1))
* allow to continue es index migration and better logging ([cd28447](https://github.com/langwatch/langwatch/commit/cd284470ce7bb0b6dff4377f3e508d65dede9e38))
* allow to just partially send the timestamps on otel, to send the time to first token, as otel already sends the start and end automatically ([f5147f6](https://github.com/langwatch/langwatch/commit/f5147f6234bf699bfdd0c7c8ebb900a838f30cfc))
* allow writing to cold index for annotating old data ([#643](https://github.com/langwatch/langwatch/issues/643)) ([908b3c6](https://github.com/langwatch/langwatch/commit/908b3c6d6600c46b79ae91ef98be67ff39a6e563))
* annotation ([#640](https://github.com/langwatch/langwatch/issues/640)) ([5de7f8c](https://github.com/langwatch/langwatch/commit/5de7f8c0dda86da6ef42d4c0af6bca0f4838c68d))
* annotation bugs ([#457](https://github.com/langwatch/langwatch/issues/457)) ([e7578f7](https://github.com/langwatch/langwatch/commit/e7578f7281979d1b604d7b07df00b99ac3e4174b))
* annotation type fixes ([#456](https://github.com/langwatch/langwatch/issues/456)) ([165643c](https://github.com/langwatch/langwatch/commit/165643c687a2bf9826987db1b6c1366a4357114c))
* autoparsing for langwatch eval components ([05f2c5f](https://github.com/langwatch/langwatch/commit/05f2c5fd7b11a439fea8e941162cdb1364599e45))
* avoid 'function already exists' lambda error ([322486c](https://github.com/langwatch/langwatch/commit/322486c8b153ada0ee3742de5ae0358b29bc77b7))
* better error handling for lambdas issues ([769a1f2](https://github.com/langwatch/langwatch/commit/769a1f2e202245e90fcf6cfc1fc60ad083022d3c))
* better strands agents tracing detection ([#533](https://github.com/langwatch/langwatch/issues/533)) ([d739d95](https://github.com/langwatch/langwatch/commit/d739d956da7b8631f7adf4477cc2a4478b8f071d))
* broken integration tests ([#519](https://github.com/langwatch/langwatch/issues/519)) ([67191ed](https://github.com/langwatch/langwatch/commit/67191eddeef79eff15024d18f43bfa193030271e))
* broken package.json on typescript sdk ([#522](https://github.com/langwatch/langwatch/issues/522)) ([85eed4c](https://github.com/langwatch/langwatch/commit/85eed4c747d5e96999556f2b23b9f6cf6750ce96))
* building in webpack was failing due to missing fallback modules ([#311](https://github.com/langwatch/langwatch/issues/311)) ([a7e1398](https://github.com/langwatch/langwatch/commit/a7e13985f9b83012f7c93aa73f00459fd60315c6))
* calling migrateToColdStorage correctly if a projectId was passed ([49cba3d](https://github.com/langwatch/langwatch/commit/49cba3d53b0ac0d0f075d5844e830d7c513ca14b))
* chain of thought ([#437](https://github.com/langwatch/langwatch/issues/437)) ([ee48fd2](https://github.com/langwatch/langwatch/commit/ee48fd2c28a1e9607c94d7402ab539ca3994ffce))
* change demonstrations format on prompt back to get demos working again on dspy ([65fb550](https://github.com/langwatch/langwatch/commit/65fb550baa8d6c6c3c3d2c2a9226d34103d52611))
* check custom series ([#459](https://github.com/langwatch/langwatch/issues/459)) ([ecc501a](https://github.com/langwatch/langwatch/commit/ecc501a43c4fb6a863fe8cc784cb8945b10cc162))
* check for email ([#505](https://github.com/langwatch/langwatch/issues/505)) ([c2d218b](https://github.com/langwatch/langwatch/commit/c2d218bf813430d543db71433be8bdb55b5afde5))
* check if saas ([#506](https://github.com/langwatch/langwatch/issues/506)) ([8f65b1c](https://github.com/langwatch/langwatch/commit/8f65b1cc34db7ca61e680c662c30ebb831a10db9))
* column name edit ([#607](https://github.com/langwatch/langwatch/issues/607)) ([f6d3c15](https://github.com/langwatch/langwatch/commit/f6d3c15e34734131ada513579f61afd8dffae80d))
* convert table columns to id-valid names when autofilling mustache variables ([#485](https://github.com/langwatch/langwatch/issues/485)) ([f2f0f40](https://github.com/langwatch/langwatch/commit/f2f0f40d19771e0c7e000f8f4d8f1fe1589dd57e))
* copro logger patching in dspy ([#465](https://github.com/langwatch/langwatch/issues/465)) ([4cec023](https://github.com/langwatch/langwatch/commit/4cec023afd274bf2983fb26ce2a094d08b836d31))
* copy-types needed shebang, and fix git checks on publish with pnpm ([#521](https://github.com/langwatch/langwatch/issues/521)) ([f371442](https://github.com/langwatch/langwatch/commit/f371442115bf93e71456ec87d3cedc403e098673))
* crash prevention and better error handling ([44a804c](https://github.com/langwatch/langwatch/commit/44a804c528dc7186e599fd3c25c492dd34ed0739))
* crisp ([#678](https://github.com/langwatch/langwatch/issues/678)) ([856284a](https://github.com/langwatch/langwatch/commit/856284afb220c7aee122e63946038dd6132a0cb4))
* csv upload with reserved column name ([#606](https://github.com/langwatch/langwatch/issues/606)) ([51bd3a9](https://github.com/langwatch/langwatch/commit/51bd3a9868af49f859f2d73167b5b8888b91876a))
* custom evaluator fixes on the studio ([#416](https://github.com/langwatch/langwatch/issues/416)) ([d91fda9](https://github.com/langwatch/langwatch/commit/d91fda92ac8c7d88147f6fdf22b92d650eb30a77))
* custom graph colour and name fix ([#475](https://github.com/langwatch/langwatch/issues/475)) ([9bc2b41](https://github.com/langwatch/langwatch/commit/9bc2b41ef809f0f301ebf4fd2a7ba41ae0c342e7))
* custom metadata was broken in new transformer code ([#326](https://github.com/langwatch/langwatch/issues/326)) ([b8e6a65](https://github.com/langwatch/langwatch/commit/b8e6a6568960a877e9635df01207ec1464ba7445))
* datagrid wasn't loading due to broken dynamic import ([#406](https://github.com/langwatch/langwatch/issues/406)) ([a66062d](https://github.com/langwatch/langwatch/commit/a66062d3318083cbe63542d3bd529cbfab229ea9))
* dataset image column type + use liquid templates instead of low level python string template to avoid having issues with json interpolation ([c6e2ede](https://github.com/langwatch/langwatch/commit/c6e2ede84687d2d5c44e40a2dba3c8ae0f242b88))
* dataset images ([#629](https://github.com/langwatch/langwatch/issues/629)) ([7e74c05](https://github.com/langwatch/langwatch/commit/7e74c05028d2e5c928abbe4d0e968875f61ef4b9))
* delete in batches and allow finer control of the move to cold storage ([642a72d](https://github.com/langwatch/langwatch/commit/642a72da25d7a217e4435b4b592c8f1d32daea52))
* dict type conversion ([db2014d](https://github.com/langwatch/langwatch/commit/db2014db189eb01ed084ea88965285c2dd18c856))
* disable server-side rendering ([#396](https://github.com/langwatch/langwatch/issues/396)) ([823020d](https://github.com/langwatch/langwatch/commit/823020db62fb16ea377ed12572158cc0ae434560))
* disable sorting on topics, metadata, events ([#481](https://github.com/langwatch/langwatch/issues/481)) ([a1cbaab](https://github.com/langwatch/langwatch/commit/a1cbaab22dbe0eeaadf8af3a3ef4699acf877eb3))
* disable tracing on evaluations and optimizations for now ([666333e](https://github.com/langwatch/langwatch/commit/666333ef6eb0542da7ff3320a0a7d76f6c914c96))
* disable usage stats by env ([#403](https://github.com/langwatch/langwatch/issues/403)) ([4f9ce9c](https://github.com/langwatch/langwatch/commit/4f9ce9cd485ee64c8b62e3746fe537e4d425014a))
* disallow non-named params to avoid confusing users ([#565](https://github.com/langwatch/langwatch/issues/565)) ([92fbeb7](https://github.com/langwatch/langwatch/commit/92fbeb7c48daffdc2c054b1cb0402e86e84390ea))
* display custom components entry even if connected to an evaluator only ([b686227](https://github.com/langwatch/langwatch/commit/b6862277e4e0f921b4ab625b812f107c1e9e6c14))
* displaying the saved analytics keys ([48af873](https://github.com/langwatch/langwatch/commit/48af873b00cc4a14041aa087ac8f8788a6bad882))
* do a second level of nesting for fixing lost metadata during race-conditions of metadata updates ([1d4454c](https://github.com/langwatch/langwatch/commit/1d4454c79ff5b5655e750f98779e045aa9815fbd))
* do not even schedule usage stats if disabled ([7167f86](https://github.com/langwatch/langwatch/commit/7167f86ce02d1eee37cefc7e2503c7cfc632bf0d))
* do not require validate single commit because we dont have the isssue described on the comment about ([c0d6d2d](https://github.com/langwatch/langwatch/commit/c0d6d2debc10b6f3d94d60d84d0766a80010add1))
* do not retry job if collection usage failed, user might be behind a proxy that can't reach outside ([e174fee](https://github.com/langwatch/langwatch/commit/e174fee1c9ce7d4d8bea777bbd9044b0870e8a12))
* downgrade litellm dependency due to https://github.com/BerriAI/litellm/issues/14145 preventing to build it on lambda ([066d97c](https://github.com/langwatch/langwatch/commit/066d97c26252c82f9143e36427782c7af19912a2))
* downgrade no organizations found from error to debug, it's not really an error ([0957967](https://github.com/langwatch/langwatch/commit/0957967a9c0426e05287b045113639618695dc0a))
* dspy optimization studio fixes for template adapter ([#477](https://github.com/langwatch/langwatch/issues/477)) ([1231a14](https://github.com/langwatch/langwatch/commit/1231a14c08fc2e9481728adb1d61a05eb12ac95e))
* env message ([#444](https://github.com/langwatch/langwatch/issues/444)) ([ea24911](https://github.com/langwatch/langwatch/commit/ea24911e60f81316a85cbfe827a154a47c1511fc))
* eval wizard bug fixes v1 ([#445](https://github.com/langwatch/langwatch/issues/445)) ([c217697](https://github.com/langwatch/langwatch/commit/c217697b5bafce94b450e1fc77cf9d31cbd569b4))
* evaluator setting fields that were being ignored for being falsy ([a2dee80](https://github.com/langwatch/langwatch/commit/a2dee80166566d39816e1f9dda6c6de31fda239c))
* executing prompts and saving prompts from the studio ([88a01fc](https://github.com/langwatch/langwatch/commit/88a01fca12a3b9d7da585f6927043f27ac002154))
* failing sdk tests ([#619](https://github.com/langwatch/langwatch/issues/619)) ([d96be17](https://github.com/langwatch/langwatch/commit/d96be171103d7ccf741b430dcb9823c60a45e929))
* fix creating and saving new prompts from scratch, make organization id mandatory ([aa54bf8](https://github.com/langwatch/langwatch/commit/aa54bf86cd64048fda3de650e8c583c6d604d2b5))
* fix model list not custom and surface eval error message ([c965e04](https://github.com/langwatch/langwatch/commit/c965e04bff6db7ffc35cd1f2e74ed88a6d1b949f))
* fix trace cost ([#487](https://github.com/langwatch/langwatch/issues/487)) ([22aa7c0](https://github.com/langwatch/langwatch/commit/22aa7c0434c66aab40f7869afbe232a88e772f37))
* flag UseSVE seems to no longer be necessary for M3+ mac families ([89a4eff](https://github.com/langwatch/langwatch/commit/89a4effc5468e0394dc0b431d2c3ecefb1dc2124))
* get rid of context for tracking current span, rely exclusively on the opentelemetry one instead, fixing out-of-parent spans ([#595](https://github.com/langwatch/langwatch/issues/595)) ([ee41980](https://github.com/langwatch/langwatch/commit/ee41980453f380a4d2954970a6aed2061ebae9c8))
* go sdk updates and readme fixes ([#423](https://github.com/langwatch/langwatch/issues/423)) ([eeb81d5](https://github.com/langwatch/langwatch/commit/eeb81d52d455d32d34e0ba0cc1afa9e13758ca17))
* gtm iframe csp ([#478](https://github.com/langwatch/langwatch/issues/478)) ([945b952](https://github.com/langwatch/langwatch/commit/945b9528bc8a945664cf4bd7bd14541a4f6b3da0))
* handle broken image message rendering ([#454](https://github.com/langwatch/langwatch/issues/454)) ([f097678](https://github.com/langwatch/langwatch/commit/f0976784b12c7a10c29d571cfc6b98fbee6ca8dc))
* helm improvements ([#450](https://github.com/langwatch/langwatch/issues/450)) ([d0a7da2](https://github.com/langwatch/langwatch/commit/d0a7da240b3a792fb2ae4e4465cd87d0388cb916))
* helm release name ([#649](https://github.com/langwatch/langwatch/issues/649)) ([51facd0](https://github.com/langwatch/langwatch/commit/51facd0f9668f1e1a7d9ecc424b9517895baf60f))
* ignore 'an update is in progress' lambda errors ([7babe9a](https://github.com/langwatch/langwatch/commit/7babe9a9c48ae9ad3a0372d0452c98033db7b0ce))
* image processing on the studio ([#458](https://github.com/langwatch/langwatch/issues/458)) ([be8b6c0](https://github.com/langwatch/langwatch/commit/be8b6c01d360a64fb70fab0496a204f5f0f10e93))
* import `get_current_span` from the correct location in litellm autotrack ([#542](https://github.com/langwatch/langwatch/issues/542)) ([082869d](https://github.com/langwatch/langwatch/commit/082869d50c6f97fe9ffcf83eb097dad67e4c1900))
* improve agno input capturing ([#528](https://github.com/langwatch/langwatch/issues/528)) ([acfc774](https://github.com/langwatch/langwatch/commit/acfc774283c0feee809e3fa7c38810d6dba9868d))
* improve how handled errors are returned to the client for the get prompt api ([#467](https://github.com/langwatch/langwatch/issues/467)) ([4d50bd9](https://github.com/langwatch/langwatch/commit/4d50bd9be86f0cd210a9138aedf9b0d01c51c45a))
* improve metadata mapping for scalar types ([#392](https://github.com/langwatch/langwatch/issues/392)) ([8024015](https://github.com/langwatch/langwatch/commit/8024015bdad383223cd15999fe5661a3100fcd13))
* increase minimum memory needed for langwatch_nlp to prevent OOM errors ([69a1787](https://github.com/langwatch/langwatch/commit/69a1787552e49b3f44b396fce697a9b59875ee44))
* inner box scenario overflow ([#567](https://github.com/langwatch/langwatch/issues/567)) ([b3f3507](https://github.com/langwatch/langwatch/commit/b3f35070aca07d3fcc449615fe34c62c09b4dd3c))
* judge agent for mcp-server test ([cd8e378](https://github.com/langwatch/langwatch/commit/cd8e3783ec02f02174ecb5fd86fa86c3f11e1734))
* langwatch/package.json & langwatch/package-lock.json to reduce vulnerabilities ([#177](https://github.com/langwatch/langwatch/issues/177)) ([c45c54c](https://github.com/langwatch/langwatch/commit/c45c54cff25305df127221059f1d9fa119f3a309))
* langwatch/package.json & langwatch/package-lock.json to reduce vulnerabilities ([#196](https://github.com/langwatch/langwatch/issues/196)) ([d051ebe](https://github.com/langwatch/langwatch/commit/d051ebe2d50052e3718852d49800cdc733d6c76e))
* limit to rendering 50 messages per thread for performance reasons ([857111a](https://github.com/langwatch/langwatch/commit/857111a00db8e4a845c0a5ce5b0fa711691aa7df))
* local running of workers ([#334](https://github.com/langwatch/langwatch/issues/334)) ([9092d27](https://github.com/langwatch/langwatch/commit/9092d27dfd18b78d6db4e5b9f8c83d123869e973))
* local setup readme guide was wrong ([#367](https://github.com/langwatch/langwatch/issues/367)) ([35d5715](https://github.com/langwatch/langwatch/commit/35d57150999a0f0cde00dde3aa1c7d5bcee81428))
* make peer dependencies more loose, remove vercel ai as a peer dep ([#526](https://github.com/langwatch/langwatch/issues/526)) ([67e4bc9](https://github.com/langwatch/langwatch/commit/67e4bc9a16e8cf71641437452d8909e152585f78))
* make scenario message validations possibly less strict, like the trace ones, for supporting vercel v5 messages without throwing 400s ([f3b2789](https://github.com/langwatch/langwatch/commit/f3b2789c2894b9fab886f69b90ff3432695c0a6b))
* make the merging of spans created by log records and normal spans more intelligent ([#545](https://github.com/langwatch/langwatch/issues/545)) ([b8a0c24](https://github.com/langwatch/langwatch/commit/b8a0c243a2c53aab6d192e0d33e616ef9f3b65f3))
* match run ids and some rework ([#571](https://github.com/langwatch/langwatch/issues/571)) ([ab39c0b](https://github.com/langwatch/langwatch/commit/ab39c0b96a0d75ef49d7a32a7c83b8fe6a4000f9))
* mcp-server ci ([0ab6e51](https://github.com/langwatch/langwatch/commit/0ab6e513129d9b1fbdb7a696ce1d99ed6093dea3))
* merge custom metadata inside the  metadata property instead of outside when updating to avoid creating new ES fields ([384117e](https://github.com/langwatch/langwatch/commit/384117e7bf5cce7b5799051f3e427da3a72d5c2c))
* migration from legacy ([#543](https://github.com/langwatch/langwatch/issues/543)) ([8098098](https://github.com/langwatch/langwatch/commit/8098098d7d593a6395b68b26e3af153611b4687b))
* missing attributes on trace ([#646](https://github.com/langwatch/langwatch/issues/646)) ([ac7ea8b](https://github.com/langwatch/langwatch/commit/ac7ea8b36ce903027fa5ea1970530f2420caec18))
* more logging improvements, and fix usage in otel collector ([#304](https://github.com/langwatch/langwatch/issues/304)) ([8ab6fcf](https://github.com/langwatch/langwatch/commit/8ab6fcfc916ad03cd8dd8e2fa020264012ffd07b))
* move extrataneous metrics to params on the span ([02b6ab1](https://github.com/langwatch/langwatch/commit/02b6ab1f6787355f4006d38231b8656d50bec22a))
* multithread tracing on python-sdk ([#411](https://github.com/langwatch/langwatch/issues/411)) ([4be3c19](https://github.com/langwatch/langwatch/commit/4be3c197735d4c9624686cd168bdcf15632c2c32))
* new member bug fixes ([#537](https://github.com/langwatch/langwatch/issues/537)) ([a0c7bc1](https://github.com/langwatch/langwatch/commit/a0c7bc1597d687f685206a5739b74f13ce419f04))
* node import in frontend ([49a3f5a](https://github.com/langwatch/langwatch/commit/49a3f5ad67a0a11ebe1d4fd05e86faf611cb636e))
* only trace if tracing is enabled ([3bfd454](https://github.com/langwatch/langwatch/commit/3bfd4542b6811bde92031f289db646e502e0ab85))
* otel misconfiguration  ([#621](https://github.com/langwatch/langwatch/issues/621)) ([55725cb](https://github.com/langwatch/langwatch/commit/55725cb0f9376b2d622c10b364922ec669b33813))
* otel traces parsing guard ([#566](https://github.com/langwatch/langwatch/issues/566)) ([33576d0](https://github.com/langwatch/langwatch/commit/33576d0a7ba844b5563b371e570ef1fe41738836))
* parametrize sentry dns at langwatch nlp ([#402](https://github.com/langwatch/langwatch/issues/402)) ([4a68684](https://github.com/langwatch/langwatch/commit/4a686842df4ddd446ed9ad8ca6446c88ea8e4b9c))
* pasting big prompts on prompt editor causing glitch on the scroll and box size ([828740c](https://github.com/langwatch/langwatch/commit/828740cbfeea616897742cbc8614c2d840c48ed8))
* pino cjs bs ([#303](https://github.com/langwatch/langwatch/issues/303)) ([76e5f13](https://github.com/langwatch/langwatch/commit/76e5f13c0ea16bfc74d51e653aa7b7df09be4392))
* potentially missing spans when updating an existing trace ([#305](https://github.com/langwatch/langwatch/issues/305)) ([1e94bd8](https://github.com/langwatch/langwatch/commit/1e94bd8ade42aa34562dd5094cd88580575ec1e0))
* pre-fetch tiktoken models during build ([#398](https://github.com/langwatch/langwatch/issues/398)) ([1d733d1](https://github.com/langwatch/langwatch/commit/1d733d1145bc72359f42226f7057b9bcc21147f0))
* prep for python-sdk@0.2.0rc5 ([#292](https://github.com/langwatch/langwatch/issues/292)) ([d380fcd](https://github.com/langwatch/langwatch/commit/d380fcd3d6e67259f39ee479beaad9f12d36ac3d))
* prepare typescript sdk ([#622](https://github.com/langwatch/langwatch/issues/622)) ([9b85394](https://github.com/langwatch/langwatch/commit/9b85394d779c29930d8ec41c50195410e9d5619a))
* prevent seeing api key, other projects and team member around the demo organization ([1c3f4d2](https://github.com/langwatch/langwatch/commit/1c3f4d2af92af82d55d4484429255e76715dfcc0))
* processing json schema with enums on the studio and dspy lazy import ([#435](https://github.com/langwatch/langwatch/issues/435)) ([9fc6e1e](https://github.com/langwatch/langwatch/commit/9fc6e1e9af7de970b8b2d234012de326fd7727e8))
* progress bar fix ([#547](https://github.com/langwatch/langwatch/issues/547)) ([9b68ab1](https://github.com/langwatch/langwatch/commit/9b68ab169767a10a0dac42ca22449aacb66638a0))
* project route fix ([#588](https://github.com/langwatch/langwatch/issues/588)) ([6b0a6f7](https://github.com/langwatch/langwatch/commit/6b0a6f78e35e5ef798c4d6debd866afb980accf3))
* prompt overflow ([#594](https://github.com/langwatch/langwatch/issues/594)) ([a15aaf8](https://github.com/langwatch/langwatch/commit/a15aaf8c84e249abb5e545234f8a0d1f2459da8b))
* prompt tracing ([#653](https://github.com/langwatch/langwatch/issues/653)) ([9d39650](https://github.com/langwatch/langwatch/commit/9d39650435d6f32f040838935a89c037e47124f6))
* prompting technique and end node change ([#430](https://github.com/langwatch/langwatch/issues/430)) ([ef1831e](https://github.com/langwatch/langwatch/commit/ef1831e8d450e8fad06d5482962fb4aab19419f6))
* proper error matching ([96a022a](https://github.com/langwatch/langwatch/commit/96a022ac86c91f3520d43be0fe12140102249f68))
* python-sdk instrumentation no need to set current span as parent as that the default ([231c8a1](https://github.com/langwatch/langwatch/commit/231c8a15a77423f395bf254d8ba0e16a75ede807))
* readme was from an early draft of the typescript sdk ([#662](https://github.com/langwatch/langwatch/issues/662)) ([5a2b115](https://github.com/langwatch/langwatch/commit/5a2b1151a0cd286390561c274a53b30ad73bad91))
* reasoning summary is an unknown parameter, and function already exists lambda was not being ignored ([dd7857e](https://github.com/langwatch/langwatch/commit/dd7857e59fead1e69c5af13926124fc46b576f52))
* remove auto added to teams now that we show admin message to do it ([#604](https://github.com/langwatch/langwatch/issues/604)) ([0974db7](https://github.com/langwatch/langwatch/commit/0974db72a91e9966f3b1590143b7e2d5baa8ec8f))
* remove dspy and litellm from being mandatory dependencies and update strands version ([#578](https://github.com/langwatch/langwatch/issues/578)) ([0af71f8](https://github.com/langwatch/langwatch/commit/0af71f89b64cde5a5dfbc6384a39784198f21a9e))
* remove knn from index settings for opensearch, it's not needed and breaks lite version without knn plugin ([#401](https://github.com/langwatch/langwatch/issues/401)) ([247b7b7](https://github.com/langwatch/langwatch/commit/247b7b791afef72862846ea1de4f60c6a7143404))
* remove need to publish workflow for export ([#421](https://github.com/langwatch/langwatch/issues/421)) ([0a4b88e](https://github.com/langwatch/langwatch/commit/0a4b88e23ea9b34c2a3c023cb888ddf41b7295aa))
* remove sorting back because that causes the accordion to close right now ([6a3b4a1](https://github.com/langwatch/langwatch/commit/6a3b4a1eed3685c10a9d0cc5ced1f63e37ad3c4a))
* replace nanoid with pksuid and remove it from openai tracer ([b4116d7](https://github.com/langwatch/langwatch/commit/b4116d704592e7e92ceee7e6a75b05b69e7596e3))
* retrieve saved non-custom model providers that are disabled/enabled and not by default ([7b19278](https://github.com/langwatch/langwatch/commit/7b1927886e4f8640665f193318db43d850dfb937))
* revert change to LangWatchExporter constructor to prevent behaviour change ([#527](https://github.com/langwatch/langwatch/issues/527)) ([21dd188](https://github.com/langwatch/langwatch/commit/21dd18810d447919d12a503a4f5f331041b67126))
* rework pagination ([#573](https://github.com/langwatch/langwatch/issues/573)) ([93df820](https://github.com/langwatch/langwatch/commit/93df820cf21b51777b0027d2c486b0206fc01b0b))
* rework routing bug ([#587](https://github.com/langwatch/langwatch/issues/587)) ([a6a43bb](https://github.com/langwatch/langwatch/commit/a6a43bbfcbc3ee424f4a78b01de2cbdc01d87eda))
* run claude-code on the CI ([d760307](https://github.com/langwatch/langwatch/commit/d760307807c72a2a0e995a4f0a42845c2cc5114a))
* run helm chart ci when workflow file changes too ([#598](https://github.com/langwatch/langwatch/issues/598)) ([024b460](https://github.com/langwatch/langwatch/commit/024b4600b1544c97b28ac39ad8653d220c50cac8))
* scenario events ES migration and helm chart issues, bump to v0.1.5 ([80c76ea](https://github.com/langwatch/langwatch/commit/80c76ea520a5cd4fd2f2f096b8355ea09dfdda05))
* scrollbars on field filters ([b4b6c5b](https://github.com/langwatch/langwatch/commit/b4b6c5b49cfcf0b4d1025a071b8ebd35578fa458))
* secrets on typescript sdk publish tests ([#520](https://github.com/langwatch/langwatch/issues/520)) ([1b88252](https://github.com/langwatch/langwatch/commit/1b882528e0d8697b7b5f36acce1e08a6e6c768d8))
* set do_not_trace for custom evals and add a mutable way to disable sending at runtime, fixing problem of reused runtimes and infinite loops in a real time eval evaluating itself and tracing ([f7d3a9f](https://github.com/langwatch/langwatch/commit/f7d3a9fde30d95efb8341c895539dff6b722c688))
* set redacted false for share url ([#432](https://github.com/langwatch/langwatch/issues/432)) ([a038ad2](https://github.com/langwatch/langwatch/commit/a038ad2f0b121e1b987514ada3c1bca1f7a3ac81))
* set the api key properly on every event ([#419](https://github.com/langwatch/langwatch/issues/419)) ([b98b560](https://github.com/langwatch/langwatch/commit/b98b56098632b9c4f89980b37280a12d2e219977))
* signup  ([#579](https://github.com/langwatch/langwatch/issues/579)) ([2ef0850](https://github.com/langwatch/langwatch/commit/2ef0850c36d7e1dcd3b647538245ba7447d1ee9b))
* simplify truncation logic ([2e65ca2](https://github.com/langwatch/langwatch/commit/2e65ca2cf1dbcdf656791827f577fd5d1f44902a))
* skip auto setup without api key ([#609](https://github.com/langwatch/langwatch/issues/609)) ([1753982](https://github.com/langwatch/langwatch/commit/1753982a8d62a48d6ead55246262acfacd4cecdc))
* skip flakey test ([#508](https://github.com/langwatch/langwatch/issues/508)) ([a5e99ee](https://github.com/langwatch/langwatch/commit/a5e99ee51fa72dae8272c0bcb10ac7dbddc71afd))
* small studio fixes ([#482](https://github.com/langwatch/langwatch/issues/482)) ([7c654bc](https://github.com/langwatch/langwatch/commit/7c654bc4fe8ec1b7b19c4989941c48cbf196a84b))
* some sdk endpoint fallbacks were to incorrect endpoints ([#548](https://github.com/langwatch/langwatch/issues/548)) ([6d63122](https://github.com/langwatch/langwatch/commit/6d63122b928de31399d00c360fa0c351df166906))
* span fix to allow all types ([#554](https://github.com/langwatch/langwatch/issues/554)) ([5892830](https://github.com/langwatch/langwatch/commit/5892830413d8cd8864cd7ab137b777413ef744c2))
* span merging ([#615](https://github.com/langwatch/langwatch/issues/615)) ([e92eed0](https://github.com/langwatch/langwatch/commit/e92eed0d2fa146d4f7e53fb3ff8c416b3c7c5fa4))
* split connection timeout and next chunk timeout for sse ([2601c76](https://github.com/langwatch/langwatch/commit/2601c7648fa369b8d6396c9bacc2e19238a45f2b))
* sso org level new user creation ([#553](https://github.com/langwatch/langwatch/issues/553)) ([b81a54b](https://github.com/langwatch/langwatch/commit/b81a54bff9f22ab70c2626b49a3d1d5f0ff72a93))
* stop resending post_event when tab switches, weird default behaviour from microsoft fetch-event-source: https://github.com/Azure/fetch-event-source/issues/36 ([2ab38cf](https://github.com/langwatch/langwatch/commit/2ab38cf6fb74852e6be9f9ce83a33bf7484d7664))
* strands agents choice events now support json and non-json content fields ([#534](https://github.com/langwatch/langwatch/issues/534)) ([d1d793b](https://github.com/langwatch/langwatch/commit/d1d793b9427b0912bce98de6959fabce4fb241e4))
* stringify nested jsonl values correctly before sending it to react-paparse ([8cf6f54](https://github.com/langwatch/langwatch/commit/8cf6f545d692789eaeb834112903b0e7854fd186))
* studio input improvements ([#414](https://github.com/langwatch/langwatch/issues/414)) ([3b9e48a](https://github.com/langwatch/langwatch/commit/3b9e48acc45939ed72557453f871a8a0e98dc68e))
* sync trace costs ([#489](https://github.com/langwatch/langwatch/issues/489)) ([83caeb2](https://github.com/langwatch/langwatch/commit/83caeb21471bf2f7312dee48b52c236765601f9b))
* thread grouping in the otel collector ([#427](https://github.com/langwatch/langwatch/issues/427)) ([cc24ddb](https://github.com/langwatch/langwatch/commit/cc24ddb528cd0558933a048e8e844a2f7a1de6e6))
* thumbs up/down filter selection, scrollbars visible on windows, overflowing badges ([5bddf75](https://github.com/langwatch/langwatch/commit/5bddf75b43295b6e204fb05bbea1b81647a23b94))
* timeseries metrics not being calculated correctly for ranges less than a day, align with summary logic now ([#397](https://github.com/langwatch/langwatch/issues/397)) ([48cd918](https://github.com/langwatch/langwatch/commit/48cd918486167bd1334354026de11ba9e497eade))
* traced prompt output & typescript default import issue ([#558](https://github.com/langwatch/langwatch/issues/558)) ([21cc4cf](https://github.com/langwatch/langwatch/commit/21cc4cfddbda2a93ad5339a39a2f901746c97195))
* traces by thread for publish share ([#434](https://github.com/langwatch/langwatch/issues/434)) ([317d695](https://github.com/langwatch/langwatch/commit/317d695f9b4f23d2e727dba3c54a5459199e21c6))
* truncate and an utf-8 safer maner to ensure byte size limits ([3549421](https://github.com/langwatch/langwatch/commit/3549421c40c0e69de3fbdc33d45a372c8938d9fe))
* type errors ([#439](https://github.com/langwatch/langwatch/issues/439)) ([2ef527d](https://github.com/langwatch/langwatch/commit/2ef527d788a05431bc2c410ac1e90c8a7b1fadb4))
* type issues from redaction ([#286](https://github.com/langwatch/langwatch/issues/286)) ([59922da](https://github.com/langwatch/langwatch/commit/59922da27ecfa8ebe8fb43c6622fb8ea4e488ef7))
* typescript sdk loicense badge to be mit and use correct logo path ([#660](https://github.com/langwatch/langwatch/issues/660)) ([688429d](https://github.com/langwatch/langwatch/commit/688429dc574167631091842690cd2c43867dd5da))
* udpate OpenTelemetry in SDK ([#417](https://github.com/langwatch/langwatch/issues/417)) ([de3e847](https://github.com/langwatch/langwatch/commit/de3e847fab1a9a14d92c7ab12f3bb1de3fa9bfce))
* ui fixes ([#676](https://github.com/langwatch/langwatch/issues/676)) ([b6d533e](https://github.com/langwatch/langwatch/commit/b6d533e89c08a38d988f503780cc9cdef1fec31c))
* update docker for nlp ([#409](https://github.com/langwatch/langwatch/issues/409)) ([4056dcf](https://github.com/langwatch/langwatch/commit/4056dcf0bf34cf8ed8f6cc4e87bf520b2f212b2c))
* update frill env usage ([#470](https://github.com/langwatch/langwatch/issues/470)) ([59f6946](https://github.com/langwatch/langwatch/commit/59f694620b624a3f52b8088bd05c484990fbcbb5))
* update github link ([#502](https://github.com/langwatch/langwatch/issues/502)) ([cf153fc](https://github.com/langwatch/langwatch/commit/cf153fc29d0e1c2df6f801afafea442353774240))
* update helm char lock file ([#596](https://github.com/langwatch/langwatch/issues/596)) ([ff22682](https://github.com/langwatch/langwatch/commit/ff226821fd72c85ff725fbf2263db6c6973bbc3d))
* update log steps ([#616](https://github.com/langwatch/langwatch/issues/616)) ([fe5fd22](https://github.com/langwatch/langwatch/commit/fe5fd22ead90abc6fef980a085e6e715428901cc))
* update nlp with latest python sdk ([#408](https://github.com/langwatch/langwatch/issues/408)) ([c0b64d1](https://github.com/langwatch/langwatch/commit/c0b64d185fa0669ea3985dc603b964584fa65fd4))
* update pagination, add specific batch id ([#577](https://github.com/langwatch/langwatch/issues/577)) ([e0d9f47](https://github.com/langwatch/langwatch/commit/e0d9f47c76c69cd73f0777aef93bdf1bdf924160))
* update scenario pagination ([#574](https://github.com/langwatch/langwatch/issues/574)) ([4b0d934](https://github.com/langwatch/langwatch/commit/4b0d934ec5838f8d7abf833a28e377ee32fcd8ba))
* update scenario_analytics.integration.test.ts ([#497](https://github.com/langwatch/langwatch/issues/497)) ([95ddb99](https://github.com/langwatch/langwatch/commit/95ddb994ff1dec306df921f340068d4d53bed9c6))
* update snippets with path and method ([#480](https://github.com/langwatch/langwatch/issues/480)) ([baad80d](https://github.com/langwatch/langwatch/commit/baad80d3edac9a5bbc9a6410d7a3c4ad3b7976ca))
* update the metadata when multiple get_current_trace().update happens instead of replacing it ([13b6921](https://github.com/langwatch/langwatch/commit/13b692103db0b24b3c769998b156dcc87ebb92f1))
* updated sync trace costs ([#495](https://github.com/langwatch/langwatch/issues/495)) ([3381f28](https://github.com/langwatch/langwatch/commit/3381f282360a53849aa3856fb3f2ce02e40ddc86))
* updating prompt after a sync ([9a2bfc4](https://github.com/langwatch/langwatch/commit/9a2bfc45d05d7b23d006f5a3896fb3228bf93c3e))
* usage stats ([#672](https://github.com/langwatch/langwatch/issues/672)) ([aa30225](https://github.com/langwatch/langwatch/commit/aa302255973601e4d7951a868a03929c15adb681))
* use client timezone also for doing the aggregations so elasticsearch can aggregate in the right date bucket ([#400](https://github.com/langwatch/langwatch/issues/400)) ([159b553](https://github.com/langwatch/langwatch/commit/159b553a619ebe596bec4b700f04837255664243))
* use langevals answer match on the studio as well, fix ui spacing for nodes ([ec40467](https://github.com/langwatch/langwatch/commit/ec4046737ee4488dfed87e7b705e0b4150c4c367))
* use the right lambda client for sync workflow invoke ([c28cdce](https://github.com/langwatch/langwatch/commit/c28cdce7cdf905fa01b6baccb5876d34fd37434a))
* use x-litellm instead of litellm to inject evaluator model config ([#591](https://github.com/langwatch/langwatch/issues/591)) ([fdfc9a6](https://github.com/langwatch/langwatch/commit/fdfc9a679cce5904b371e95971096e5225d139a1))


### Miscellaneous

* add csp headers for gtm and reo dev ([#476](https://github.com/langwatch/langwatch/issues/476)) ([03119fe](https://github.com/langwatch/langwatch/commit/03119fecbad2e0f9e2d68568726c83d317bbf9d1))
* add google adk example ([#564](https://github.com/langwatch/langwatch/issues/564)) ([8165344](https://github.com/langwatch/langwatch/commit/8165344de410e0474ef9474b1b49f16033ed7e60))
* add nlp, eval endpoint check ([#443](https://github.com/langwatch/langwatch/issues/443)) ([f6fb621](https://github.com/langwatch/langwatch/commit/f6fb621b06715161c737345a6ba153f0032357e5))
* add prometheus metric to track event loop lag ([#463](https://github.com/langwatch/langwatch/issues/463)) ([f8926e6](https://github.com/langwatch/langwatch/commit/f8926e6f2315c0b9f4e0ab8aecfcf94225ab5df4))
* add rate limiter to trpc ([#453](https://github.com/langwatch/langwatch/issues/453)) ([6e4c9a5](https://github.com/langwatch/langwatch/commit/6e4c9a554a4e8891843d0167fa247d802800437e))
* add release please ([#624](https://github.com/langwatch/langwatch/issues/624)) ([e46cd21](https://github.com/langwatch/langwatch/commit/e46cd210e09c5dde95f030c3f92014f882272944))
* add release please for python sdk ([#631](https://github.com/langwatch/langwatch/issues/631)) ([5e7c5aa](https://github.com/langwatch/langwatch/commit/5e7c5aa90754fb8c692f9dcd7dd5781549f11f6b))
* add script to migrate metadata that is sitting on the wrong place ([3df69a5](https://github.com/langwatch/langwatch/commit/3df69a5f571e714e22d4fafd58bb3cdc5e3c4ff4))
* add team check ([#600](https://github.com/langwatch/langwatch/issues/600)) ([21d225a](https://github.com/langwatch/langwatch/commit/21d225a1c28bbbcf529171ff24dde28229a0fcfd))
* add toast ([#603](https://github.com/langwatch/langwatch/issues/603)) ([915280d](https://github.com/langwatch/langwatch/commit/915280d9bd0e6c5be4104018b8b2ae83660da1ed))
* added go examples, fixed two otel collector issues, refactored the go sdk for initial release ([#425](https://github.com/langwatch/langwatch/issues/425)) ([7a3ee9a](https://github.com/langwatch/langwatch/commit/7a3ee9a6c648b76410bcff604ad99e4df6462f5a))
* added more tests for client ([#418](https://github.com/langwatch/langwatch/issues/418)) ([e7b067b](https://github.com/langwatch/langwatch/commit/e7b067b9bf735f7feaf7f66fe4d6b27b3171243d))
* bump litellm ([#538](https://github.com/langwatch/langwatch/issues/538)) ([9d89314](https://github.com/langwatch/langwatch/commit/9d8931470212214032dfed288b4764476d6cf1df))
* bump to v0.2.3 ([f648f4d](https://github.com/langwatch/langwatch/commit/f648f4dcbdb1cd87369d90e6ab756e652ab03e1e))
* fix OpenSearch startup issue on amd64 ([#539](https://github.com/langwatch/langwatch/issues/539)) ([8d319fe](https://github.com/langwatch/langwatch/commit/8d319fefcf757dba568182df5a806aeea584a3ab))
* hide custom key ([#592](https://github.com/langwatch/langwatch/issues/592)) ([b70d8b7](https://github.com/langwatch/langwatch/commit/b70d8b786d5201a2c810aa6429dbaebba97f7a26))
* http logging for collector endpoints ([#513](https://github.com/langwatch/langwatch/issues/513)) ([9476202](https://github.com/langwatch/langwatch/commit/9476202a03ac7507916857331dfca9d6d5dcd28b))
* improve otel collector - metadata gathering+mapping, fix params not being wiped correctly, redaction ui bug ([#327](https://github.com/langwatch/langwatch/issues/327)) ([af60335](https://github.com/langwatch/langwatch/commit/af603352a3fb5b85e7edee48b89b718b2a151130))
* improve typescript sdk dependencies to play nicer with other children ([#659](https://github.com/langwatch/langwatch/issues/659)) ([da3daa9](https://github.com/langwatch/langwatch/commit/da3daa9a8013b1eb568ee256b33227fe57f9dafe))
* improve worker restarting ([#332](https://github.com/langwatch/langwatch/issues/332)) ([3cd168a](https://github.com/langwatch/langwatch/commit/3cd168a4e804beb952151988062783b1a059a6ef))
* improved general logging health ([#309](https://github.com/langwatch/langwatch/issues/309)) ([df8164f](https://github.com/langwatch/langwatch/commit/df8164f618c679451b01140cfee49276fbfbff5c))
* log status code and user agent, add user/project/org to hono ([#455](https://github.com/langwatch/langwatch/issues/455)) ([c066757](https://github.com/langwatch/langwatch/commit/c066757cc86a7080a81ada9769a7812581b761a2))
* **main:** release typescript-sdk 0.5.1 ([#627](https://github.com/langwatch/langwatch/issues/627)) ([1f5c9bc](https://github.com/langwatch/langwatch/commit/1f5c9bcb68ba3ccb4d18cdd21e730c88a9989f02))
* metadata tests to catch regressions in the python sdk ([#452](https://github.com/langwatch/langwatch/issues/452)) ([ab32758](https://github.com/langwatch/langwatch/commit/ab327585e9782a0bfe0a324d1356c0e39c0e11fe))
* nicer logs collector worker ([#294](https://github.com/langwatch/langwatch/issues/294)) ([0f8ee70](https://github.com/langwatch/langwatch/commit/0f8ee70ab448afc1b2f6bdfc4a30b621d1a23cae))
* python sdk setup/trace improvements, and strands example update ([#581](https://github.com/langwatch/langwatch/issues/581)) ([95c1833](https://github.com/langwatch/langwatch/commit/95c18339e3228482c2e9d90babdd9828dc21250e))
* release chart ([0ecdc9c](https://github.com/langwatch/langwatch/commit/0ecdc9c95a3a47c51befce2a052cfdc15fb63c1c))
* release main ([#639](https://github.com/langwatch/langwatch/issues/639)) ([662b654](https://github.com/langwatch/langwatch/commit/662b654e522b3453628b883a7009b3bf95ef8645))
* release main ([#644](https://github.com/langwatch/langwatch/issues/644)) ([702e5d1](https://github.com/langwatch/langwatch/commit/702e5d1120a635537e6e2d4c6817156debe366fb))
* release main ([#652](https://github.com/langwatch/langwatch/issues/652)) ([dbacf6b](https://github.com/langwatch/langwatch/commit/dbacf6b374dd01a6f3963d52d4cb10ced5609b80))
* release main ([#654](https://github.com/langwatch/langwatch/issues/654)) ([51b8f2e](https://github.com/langwatch/langwatch/commit/51b8f2ee9b1742e5be58ed130b491f1ee4325012))
* release main ([#655](https://github.com/langwatch/langwatch/issues/655)) ([6d7edc9](https://github.com/langwatch/langwatch/commit/6d7edc9e9e0a74f7e6a728320845edb56b45febe))
* remove atla ts ([#667](https://github.com/langwatch/langwatch/issues/667)) ([b23fa61](https://github.com/langwatch/langwatch/commit/b23fa61d99b5888ada98e789acbbd39cb34b5731))
* remove frill ([#474](https://github.com/langwatch/langwatch/issues/474)) ([8779095](https://github.com/langwatch/langwatch/commit/8779095e233cc68ae1f9878bfec5668382456c05))
* remove legacy python sdk ([#466](https://github.com/langwatch/langwatch/issues/466)) ([aa2540e](https://github.com/langwatch/langwatch/commit/aa2540e18483a48041ee3bc7551779751b2b14bf))
* replace all backend loggers with new logger for structured logging in aws  ([#307](https://github.com/langwatch/langwatch/issues/307)) ([b97fac1](https://github.com/langwatch/langwatch/commit/b97fac180f9e60e322ddea629c664286884b7352))
* rework models ([#658](https://github.com/langwatch/langwatch/issues/658)) ([250f4f3](https://github.com/langwatch/langwatch/commit/250f4f30d12581f3b55290f152da2049183940d6))
* rewrite go sdk readme ([#426](https://github.com/langwatch/langwatch/issues/426)) ([497b0b0](https://github.com/langwatch/langwatch/commit/497b0b098134f44b5d0adb466a11e9623bb12c09))
* update auto versioning and fix manifest ([#651](https://github.com/langwatch/langwatch/issues/651)) ([ce4f70f](https://github.com/langwatch/langwatch/commit/ce4f70f6d1b236511acc4a2708dfd8bcccbbe3c9))
* update console colors ([#509](https://github.com/langwatch/langwatch/issues/509)) ([88e5500](https://github.com/langwatch/langwatch/commit/88e5500de5afa26a86907a15dfc428157eb0238e))
* update python sdk to support Python 3.13 ([#557](https://github.com/langwatch/langwatch/issues/557)) ([d982a80](https://github.com/langwatch/langwatch/commit/d982a807be867df52c75aadaa2fb479b81d794d4))
* update python version ([#552](https://github.com/langwatch/langwatch/issues/552)) ([14a2ea6](https://github.com/langwatch/langwatch/commit/14a2ea61297c1a690c8f1d4dbf31c31547bea41c))
* update typescript sdk examples ([#413](https://github.com/langwatch/langwatch/issues/413)) ([dafe461](https://github.com/langwatch/langwatch/commit/dafe46160974213465431c0c8bd96a12ca4f28a1))


### Documentation

* add detailed markdown documentation for LangWatch eval notebook ([#618](https://github.com/langwatch/langwatch/issues/618)) ([525b62a](https://github.com/langwatch/langwatch/commit/525b62ad6ea01f122297b1a3fd1eb7e842479f19))
* add pdf parsing evaluation example ([0e5bd93](https://github.com/langwatch/langwatch/commit/0e5bd93735c4a5ee815d54962955aa75e3bb996b))
* added mcp-server contributing guide ([19d1431](https://github.com/langwatch/langwatch/commit/19d14313824663842e5bba3a98986b9b80382300))
* improve notebook descriptions ([fa1f267](https://github.com/langwatch/langwatch/commit/fa1f26705bfff3143dbd6d16edfdae86bd5ce6bd))
* license link on readme ([7e9172a](https://github.com/langwatch/langwatch/commit/7e9172afd9227b9001aa6fa7b5de70b024eb96f9))
* update offline evaluation example with an image ([509f00b](https://github.com/langwatch/langwatch/commit/509f00b297f4356e2598cacfc1741f030f99dacf))


### Code Refactoring

* improved type safety and SRP services ([#611](https://github.com/langwatch/langwatch/issues/611)) ([1270e4b](https://github.com/langwatch/langwatch/commit/1270e4b1ef3447d65d2d0fb9b5264a3d5a727547))
* remove rendudant build ([bb8d169](https://github.com/langwatch/langwatch/commit/bb8d169d9455cb3b5fefa3461fcb9b3911fb32a1))
* split collector and processor helathchecks endpoints ([#399](https://github.com/langwatch/langwatch/issues/399)) ([0eefbe5](https://github.com/langwatch/langwatch/commit/0eefbe52aa56dea45d3f8526d120f0f7c3c53843))
* split tool call fix helper ([c95028f](https://github.com/langwatch/langwatch/commit/c95028fba882357b33ca975e9d08ceabfe5cfc1c))
