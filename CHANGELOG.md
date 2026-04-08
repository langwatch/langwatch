# Changelog

## [3.0.0-prerelease.4](https://github.com/langwatch/langwatch/compare/langwatch@v3.0.0-prerelease.3...langwatch@v3.0.0-prerelease.4) (2026-04-08)


### Features

* add evaluator CLI commands ([#2981](https://github.com/langwatch/langwatch/issues/2981)) ([57577ac](https://github.com/langwatch/langwatch/commit/57577acac70a8f907c27c66a099cd7e10ebe7941))


### Bug Fixes

* address helm chart bugbash findings ([#3034](https://github.com/langwatch/langwatch/issues/3034)) ([e08c777](https://github.com/langwatch/langwatch/commit/e08c77769f197e166862683ab287e91117df81b1))
* default publicUrl/baseHost to localhost:5560 ([#3035](https://github.com/langwatch/langwatch/issues/3035)) ([533f204](https://github.com/langwatch/langwatch/commit/533f204215628afb42fcbaca5b16cbd3b1f7e8fa))
* default publicUrl/baseHost to localhost:5560 instead of 30560 ([533f204](https://github.com/langwatch/langwatch/commit/533f204215628afb42fcbaca5b16cbd3b1f7e8fa))
* increase scenario execution timeout from 5 to 15 minutes ([#3006](https://github.com/langwatch/langwatch/issues/3006)) ([5578ac5](https://github.com/langwatch/langwatch/commit/5578ac576e22f5d06ba5260724492397fe000c49))

## [3.0.0-prerelease.3](https://github.com/langwatch/langwatch/compare/langwatch@v3.0.0-prerelease.2...langwatch@v3.0.0-prerelease.3) (2026-04-08)


### Features

* rename helm chart from langwatch-helm to langwatch ([#3032](https://github.com/langwatch/langwatch/issues/3032)) ([921a1cb](https://github.com/langwatch/langwatch/commit/921a1cb913801629b8d9245187dec749f9beec31))

## [3.0.0-prerelease.2](https://github.com/langwatch/langwatch/compare/langwatch@v3.0.0-prerelease.1...langwatch@v3.0.0-prerelease.2) (2026-04-08)


### Bug Fixes

* regenerate Chart.lock for clickhouse-serverless 0.2.0 ([#3029](https://github.com/langwatch/langwatch/issues/3029)) ([afd5f6e](https://github.com/langwatch/langwatch/commit/afd5f6e0ad8e814c560b1a285fbfa9450d1c20a7))
* set clickhouse-serverless default image tag to 0.2.0 ([#3030](https://github.com/langwatch/langwatch/issues/3030)) ([aef43d7](https://github.com/langwatch/langwatch/commit/aef43d71fff0e392a006e50f4265f48c0f18f84c))
* set clickhouse-serverless image tag to 0.2.0 (was 'next' which doesn't exist) ([aef43d7](https://github.com/langwatch/langwatch/commit/aef43d71fff0e392a006e50f4265f48c0f18f84c))


### Documentation

* overhaul self-hosting documentation for 3.0 (ClickHouse, Helm, no ES) ([#3027](https://github.com/langwatch/langwatch/issues/3027)) ([f468b77](https://github.com/langwatch/langwatch/commit/f468b774adec1d2903efd363bbb97982c2617fcc))

## [3.0.0-prerelease.1](https://github.com/langwatch/langwatch/compare/langwatch@v3.0.0-prerelease.1...langwatch@v3.0.0-prerelease.1) (2026-04-08)


### Features

* add /code-review skill for project-level rule checks ([#2923](https://github.com/langwatch/langwatch/issues/2923)) ([6d338b3](https://github.com/langwatch/langwatch/commit/6d338b3bcd55451ef9907983c4e46f43661b558a))
* add /postmortem skill for structured incident investigation and write-up ([#2658](https://github.com/langwatch/langwatch/issues/2658)) ([859a9ea](https://github.com/langwatch/langwatch/commit/859a9ea3fae7dce7f74f437d64b90bf15ae63c78))
* add blockers to RBAC/Audit logs ([#1924](https://github.com/langwatch/langwatch/issues/1924)) ([0c0b09a](https://github.com/langwatch/langwatch/commit/0c0b09ad6057e21415caca1f42782bff42a37374))
* add dspy steps to clickhouse and setup app-layer ([#2386](https://github.com/langwatch/langwatch/issues/2386)) ([7b7fcd8](https://github.com/langwatch/langwatch/commit/7b7fcd8de631ad00bb4c438ae855d6685aa76937))
* add has_subscription trait to Customer.io ([#2764](https://github.com/langwatch/langwatch/issues/2764)) ([98432e3](https://github.com/langwatch/langwatch/commit/98432e38cdd42835af57870506d18eee58e3237e))
* add langwatch.source=platform attribute for platform-originated traces ([eb39d74](https://github.com/langwatch/langwatch/commit/eb39d74b9d7f7555af8cb68c2b8a0e03716bb25e))
* add langwatch.source=platform for platform-originated traces ([#2073](https://github.com/langwatch/langwatch/issues/2073)) ([eb39d74](https://github.com/langwatch/langwatch/commit/eb39d74b9d7f7555af8cb68c2b8a0e03716bb25e))
* add OTLP-spec partialSuccess to trace ingestion responses ([#2494](https://github.com/langwatch/langwatch/issues/2494)) ([4f6ac45](https://github.com/langwatch/langwatch/commit/4f6ac45b291951e998cb362280dc231558f53b2a))
* add PII guard to create-issue skill and new kanban board skill ([f93c018](https://github.com/langwatch/langwatch/commit/f93c018e26883821486695538a7034f6c6230d93)), closes [#2559](https://github.com/langwatch/langwatch/issues/2559)
* add playwright-headed MCP server for interactive browser testing ([#2689](https://github.com/langwatch/langwatch/issues/2689)) ([18304f5](https://github.com/langwatch/langwatch/commit/18304f5fa99186d883c498d9d69beefec817cd62))
* add prompt tag support to MCP tools, docs, and skills ([#2934](https://github.com/langwatch/langwatch/issues/2934)) ([858e0d7](https://github.com/langwatch/langwatch/commit/858e0d7df3df8c70822e2155a73453bf1a6fd324))
* add reusable announcement banner component ([#2594](https://github.com/langwatch/langwatch/issues/2594)) ([af25e42](https://github.com/langwatch/langwatch/commit/af25e42a0795aab681663486048edf619ba7b5b8))
* add skills publish pipeline to langwatch/skills repo ([#2415](https://github.com/langwatch/langwatch/issues/2415)) ([9b769fe](https://github.com/langwatch/langwatch/commit/9b769fe8b6e11a18434e967564697a26c48f8aa0))
* add SSO migration banner and improve SSO account linking ([#2526](https://github.com/langwatch/langwatch/issues/2526)) ([8d4e195](https://github.com/langwatch/langwatch/commit/8d4e195e0d0b52219dd0923e8b82263d23d4505b))
* **agents:** add View History to agent 3-dot menu with audit log drawer ([#2243](https://github.com/langwatch/langwatch/issues/2243)) ([429529f](https://github.com/langwatch/langwatch/commit/429529f9af5d99e0188932989b080e85705291d3))
* align workflow empty state and new workflow modal with evaluations style ([#2742](https://github.com/langwatch/langwatch/issues/2742)) ([da060f7](https://github.com/langwatch/langwatch/commit/da060f70d7fec7a5c64ac61cd2c753dd7500d611))
* allow lite members partial trace access with restricted tabs ([#2666](https://github.com/langwatch/langwatch/issues/2666)) ([d421d33](https://github.com/langwatch/langwatch/commit/d421d332db1545172111772dbfc2cedff76b86a5))
* **analytics:** add identification and event tracking with from limits to subscription ([#2221](https://github.com/langwatch/langwatch/issues/2221)) ([3a15218](https://github.com/langwatch/langwatch/commit/3a15218027c9103002ce2e66cb8657bbeeddc476))
* **analytics:** suppress PostHog tracking during admin impersonation ([#2244](https://github.com/langwatch/langwatch/issues/2244)) ([b6b955a](https://github.com/langwatch/langwatch/commit/b6b955a31e8216715c5a33c15815d27271da7b7d))
* **api:** enforce resource limits on API create endpoints ([#2205](https://github.com/langwatch/langwatch/issues/2205)) ([a361eab](https://github.com/langwatch/langwatch/commit/a361eab0ed00646b9c89e5d99b16311b3e2c3ce0))
* auto-regenerate docs prompts + llms.txt via git hooks + CI ([#2686](https://github.com/langwatch/langwatch/issues/2686)) ([9f78ffa](https://github.com/langwatch/langwatch/commit/9f78ffae2257c8a233b318957f06aa264f9ccac1))
* **billing:** add invoices display to subscription page ([#2035](https://github.com/langwatch/langwatch/issues/2035)) ([f25d48a](https://github.com/langwatch/langwatch/commit/f25d48a1eccc41adcb406115f03dae70079b52da))
* **billing:** update Growth Events pricing to €5/100K EUR, $6/100K USD ([#2123](https://github.com/langwatch/langwatch/issues/2123)) ([3973986](https://github.com/langwatch/langwatch/commit/397398612a0c58e5715edc3f973f8ab8be8733b3))
* **collection:** drop spans outside the accepted time window ([#2785](https://github.com/langwatch/langwatch/issues/2785)) ([cc78ff7](https://github.com/langwatch/langwatch/commit/cc78ff7201fb79e030d55ca7f617291736d17ea7))
* custom prompt labels — Deploy dialog UI ([#2824](https://github.com/langwatch/langwatch/issues/2824)) ([#2844](https://github.com/langwatch/langwatch/issues/2844)) ([706868e](https://github.com/langwatch/langwatch/commit/706868e13197d23e46ee26899f686255b896c91f))
* custom prompt tag definitions API (CRUD) ([#2838](https://github.com/langwatch/langwatch/issues/2838)) ([7b3d1be](https://github.com/langwatch/langwatch/commit/7b3d1bed0d5c5370ab1bcfc931f5e2fbad54c8ac))
* **datasets-api:** add POST /:slugOrId/records for batch record creation ([#2906](https://github.com/langwatch/langwatch/issues/2906)) ([09c5317](https://github.com/langwatch/langwatch/commit/09c531785a47840bc954977aa4a50b545d556a5e))
* **dev:** isolated per-worktree dev instances for AI agent browser testing ([#2217](https://github.com/langwatch/langwatch/issues/2217)) ([9b3ba51](https://github.com/langwatch/langwatch/commit/9b3ba5137b81d1e334a5944db2313b6c41bf4260))
* **docs:** restructure skills pages with accordion UI ([#2845](https://github.com/langwatch/langwatch/issues/2845)) ([497f226](https://github.com/langwatch/langwatch/commit/497f226477fc46d193883aa920eae06bad6c9170))
* **elasticsearch:** add flags to disable ES writes for fully-migrated ClickHouse customers ([#2034](https://github.com/langwatch/langwatch/issues/2034)) ([e44bb7e](https://github.com/langwatch/langwatch/commit/e44bb7e0be6fc334f2aadc37649769c2ac60f0e8))
* enable ES write disable flags by default for SaaS customers ([#2051](https://github.com/langwatch/langwatch/issues/2051)) ([8a3ee8f](https://github.com/langwatch/langwatch/commit/8a3ee8f9857f7d5335d26bd65d7044b846334cdf))
* enable PostHog frontend error capture and session recording ([#2126](https://github.com/langwatch/langwatch/issues/2126)) ([36eb77c](https://github.com/langwatch/langwatch/commit/36eb77cebc396bc83af7afbb89a6654f0054d8e8))
* **evaluations-v3:** add Run button for pending evaluators and Run on all rows ([#2211](https://github.com/langwatch/langwatch/issues/2211)) ([a2e37a3](https://github.com/langwatch/langwatch/commit/a2e37a3aaa6789eb3bd9f978089b677382fe6bdb))
* **evaluations-v3:** show disabled run buttons with tooltips when no target output ([#2233](https://github.com/langwatch/langwatch/issues/2233)) ([f679a3e](https://github.com/langwatch/langwatch/commit/f679a3e1e5a33947cdd48cf40954d24c83a6c23d))
* **evaluations:** expand online evaluation preconditions to all trace-time filters ([#2122](https://github.com/langwatch/langwatch/issues/2122)) ([7d35c63](https://github.com/langwatch/langwatch/commit/7d35c63e76f5162a95588bf030f92515b2137910))
* **evaluations:** expose thread variables in trace-level evaluator mapping ([#2794](https://github.com/langwatch/langwatch/issues/2794)) ([750ad39](https://github.com/langwatch/langwatch/commit/750ad39c77314e477df3784ba807124fc1eb4c1b))
* **evaluators:** add View History drawer ([#2272](https://github.com/langwatch/langwatch/issues/2272)) ([423a9dd](https://github.com/langwatch/langwatch/commit/423a9ddf2dee9232f01f65e92062b4517f1b4e06))
* event-driven annotation sync to ClickHouse ([#2734](https://github.com/langwatch/langwatch/issues/2734)) ([6120c33](https://github.com/langwatch/langwatch/commit/6120c33e5a9867686f0f09b788af2c84e583c2d1))
* event-sourcing event idempotency, dark mode progress, trace query optimisations, es migration script ([#2124](https://github.com/langwatch/langwatch/issues/2124)) ([53df5fb](https://github.com/langwatch/langwatch/commit/53df5fb21b242b673de1345f1a8061276da21a5d))
* **event-sourcing:** auto-generate hierarchical group keys from pipeline topology ([4e56e0f](https://github.com/langwatch/langwatch/commit/4e56e0f468b39410d7d63199881acfb569cfa8a6))
* **event-sourcing:** hierarchical group keys to eliminate cross-type queue contention ([#2258](https://github.com/langwatch/langwatch/issues/2258)) ([4e56e0f](https://github.com/langwatch/langwatch/commit/4e56e0f468b39410d7d63199881acfb569cfa8a6))
* expand dataset rest api with full crud endpoints ([#2711](https://github.com/langwatch/langwatch/issues/2711)) ([e29c2f3](https://github.com/langwatch/langwatch/commit/e29c2f37b09b311e7a9c90d93050b670a1d62e24))
* expand trace export with depth ([#2403](https://github.com/langwatch/langwatch/issues/2403)) ([763bc5b](https://github.com/langwatch/langwatch/commit/763bc5b4186445bf0269ed035510e358ddcc73cc))
* full-text search on trace computed I/O ([#2780](https://github.com/langwatch/langwatch/issues/2780)) ([9a5837b](https://github.com/langwatch/langwatch/commit/9a5837b10fee4951b9889dd3670343f9f52cdaa2))
* improve event sourcing throughput (flatten scores, widen/random offset scan, parallelise map projections) ([#2206](https://github.com/langwatch/langwatch/issues/2206)) ([88c9b9c](https://github.com/langwatch/langwatch/commit/88c9b9cb0d409bdbae6b4b9cc8aaf00c02d2c52e))
* improve random offset to allow full spread access ([#2215](https://github.com/langwatch/langwatch/issues/2215)) ([dac046a](https://github.com/langwatch/langwatch/commit/dac046ae26a10a7dfee59bfb705b8894e6920d8c))
* improved experiment runs with parallel grouping  ([#2057](https://github.com/langwatch/langwatch/issues/2057)) ([a42dc0f](https://github.com/langwatch/langwatch/commit/a42dc0f80a9c78e806c6ab27cc8f8cb9d0437564))
* **licensing:** add self-serving license infrastructure ([#1891](https://github.com/langwatch/langwatch/issues/1891)) ([737a6e0](https://github.com/langwatch/langwatch/commit/737a6e00a39ee1ae31fb45b3d081ddafd3ce63f4))
* **licensing:** enforce experiment limit on SDK init ([#2332](https://github.com/langwatch/langwatch/issues/2332)) ([e62c82f](https://github.com/langwatch/langwatch/commit/e62c82f3a581598737ed135868924bbb8d93ab62))
* link up http REST api to event sourcing ([#2076](https://github.com/langwatch/langwatch/issues/2076)) ([8b5f090](https://github.com/langwatch/langwatch/commit/8b5f09048ccdbb52667f0ea76abd9809501e41bc))
* log slow ClickHouse queries at warn level for CloudWatch monitoring ([#2820](https://github.com/langwatch/langwatch/issues/2820)) ([06e4a68](https://github.com/langwatch/langwatch/commit/06e4a68de413597e41b14e3ed611eba5431d23a4))
* log slow/heavy ClickHouse queries with per-query expectations ([06e4a68](https://github.com/langwatch/langwatch/commit/06e4a68de413597e41b14e3ed611eba5431d23a4))
* **mcp:** mount MCP HTTP server in-app with OAuth PKCE authorization ([#2847](https://github.com/langwatch/langwatch/issues/2847)) ([9d57dd8](https://github.com/langwatch/langwatch/commit/9d57dd877f80ba529d32879a387d4f4d0d0216b6))
* **meta:** combine /watch-ci and /pr-review into /drive-pr skill ([#2193](https://github.com/langwatch/langwatch/issues/2193)) ([2509593](https://github.com/langwatch/langwatch/commit/2509593f772fdaa485bc0fa33c730daea39dccef))
* modernize onboarding UI with dark mode support and design system alignment ([#2339](https://github.com/langwatch/langwatch/issues/2339)) ([366eb8d](https://github.com/langwatch/langwatch/commit/366eb8d1917a2ec8c1396fb427d8ee50d44831cb))
* modernize suites page UI and scenarios drawer a bit and misc fixes ([#2394](https://github.com/langwatch/langwatch/issues/2394)) ([7c8036b](https://github.com/langwatch/langwatch/commit/7c8036beeafee7fb30bb73810ad0e7d2016e8423))
* **nurturing:** adding NurturingService foundation logic ([#2465](https://github.com/langwatch/langwatch/issues/2465)) ([48fc4e7](https://github.com/langwatch/langwatch/commit/48fc4e71185cfde1920d99d6f35f9239bcf7a80c))
* **nurturing:** event sourcing reactors for Customer.io sync ([#2492](https://github.com/langwatch/langwatch/issues/2492)) ([7b73103](https://github.com/langwatch/langwatch/commit/7b731035bc4176239cd23608d87dd14fc29c2602))
* **nurturing:** productInterest and promptCreation hooks ([#2531](https://github.com/langwatch/langwatch/issues/2531)) ([1d64d4e](https://github.com/langwatch/langwatch/commit/1d64d4e55ae5ee52718493160e7fab04e1e04e5d))
* **nurturing:** register CIO reactors in event sourcing pipelines ([#2591](https://github.com/langwatch/langwatch/issues/2591)) ([231d963](https://github.com/langwatch/langwatch/commit/231d963a38be3225a7c65884f529024171b4800e))
* **nurturing:** signup hooks, lazy backfill, and product interest ([#2590](https://github.com/langwatch/langwatch/issues/2590)) ([8a01dec](https://github.com/langwatch/langwatch/commit/8a01dec66457736ff80f332cf39e8c15af965326))
* **nurturing:** signup, adoption, and activity hooks ([#2491](https://github.com/langwatch/langwatch/issues/2491)) ([c4ce41c](https://github.com/langwatch/langwatch/commit/c4ce41c3ca11dac1dcc7bf4512ea43e39405399e))
* **orchestrator:** add lightweight bug-fix workflow ([#2134](https://github.com/langwatch/langwatch/issues/2134)) ([4831a70](https://github.com/langwatch/langwatch/commit/4831a70fe7b30fa53efd99de164c2acd6e9837cd)), closes [#2132](https://github.com/langwatch/langwatch/issues/2132)
* pass organizationId to SDK radar feature flag and disable redirects ([77e53ce](https://github.com/langwatch/langwatch/commit/77e53ce5c9dc9a61637e38fc8261ef076c9fafbd))
* per-organization ClickHouse and S3 routing for private dataplanes ([#2535](https://github.com/langwatch/langwatch/issues/2535)) ([6c36845](https://github.com/langwatch/langwatch/commit/6c36845efeb5db0bc0736886c3e718d8bfeed843))
* projection-replay CLI with pause-based drain and batch writes ([#2859](https://github.com/langwatch/langwatch/issues/2859)) ([657faf7](https://github.com/langwatch/langwatch/commit/657faf726d3453a807237a813e6ccc111f745db3))
* promote simulation runs page to primary with path-based URLs ([#2946](https://github.com/langwatch/langwatch/issues/2946)) ([03f3103](https://github.com/langwatch/langwatch/commit/03f310304b7af1e517afe1b3009672a30cae2376))
* prompt labels data model, migration, and API endpoints ([#2712](https://github.com/langwatch/langwatch/issues/2712)) ([3ae192d](https://github.com/langwatch/langwatch/commit/3ae192d8ca9256305222bb008693ad564527a0d0))
* **prompts:** add View History to sidebar 3-dot menu ([#2241](https://github.com/langwatch/langwatch/issues/2241)) ([1a5601a](https://github.com/langwatch/langwatch/commit/1a5601a3fbbdb8e3de790ace252b4b093a493dd6))
* **prompts:** auto-detect template variables during prompt sync ([#2226](https://github.com/langwatch/langwatch/issues/2226)) ([eb4ca40](https://github.com/langwatch/langwatch/commit/eb4ca40af8506f9818d4d3528dc6e02cdeb48354))
* **prompts:** deploy prompt dialog for managing version labels ([#2784](https://github.com/langwatch/langwatch/issues/2784)) ([25b2b35](https://github.com/langwatch/langwatch/commit/25b2b350f862a23c61d2ebaf5815ed5d2b8be551))
* **prompts:** dynamic LLM parameter mapping for Open in Prompts ([#2219](https://github.com/langwatch/langwatch/issues/2219)) ([17c2a86](https://github.com/langwatch/langwatch/commit/17c2a8653db95215288dc130fecac152ae6b29c3))
* **prompts:** dynamic LLM parameter mapping for Open in Prompts flow ([17c2a86](https://github.com/langwatch/langwatch/commit/17c2a8653db95215288dc130fecac152ae6b29c3))
* **prompts:** open existing prompt from trace when prompt handle is present ([#2223](https://github.com/langwatch/langwatch/issues/2223)) ([428f8ff](https://github.com/langwatch/langwatch/commit/428f8ff22b8cb5a4be5942d5b26bf2d62f44d7be))
* **prompts:** open in prompts, loading UX, output extraction, ancestor lookup ([#2253](https://github.com/langwatch/langwatch/issues/2253)) ([5a7c06d](https://github.com/langwatch/langwatch/commit/5a7c06dc61ab568ccfb0135d0ff5d6ea22554d74))
* python SDK prompt label support ([#2795](https://github.com/langwatch/langwatch/issues/2795)) ([13b230b](https://github.com/langwatch/langwatch/commit/13b230b879e8ebde77654b88ba2cfb28813fe97c))
* **python-sdk:** add custom prompt tag support ([#2843](https://github.com/langwatch/langwatch/issues/2843)) ([8699076](https://github.com/langwatch/langwatch/commit/869907635b9c57f0216f0f9cb7beb2b85c31eef5))
* **rbac:** lite member permission infrastructure ([#2522](https://github.com/langwatch/langwatch/issues/2522)) ([3af1486](https://github.com/langwatch/langwatch/commit/3af1486c1e5eba7686e0320ec3da0412bf7c9e14))
* **rbac:** revise lite member restrictions to action-level blocking ([#2261](https://github.com/langwatch/langwatch/issues/2261)) ([2564d56](https://github.com/langwatch/langwatch/commit/2564d564ecf45a4b649c9b3a36e37e8055896d25))
* real-time SSE + adaptive polling for suite run views ([#2007](https://github.com/langwatch/langwatch/issues/2007)) ([4afe396](https://github.com/langwatch/langwatch/commit/4afe396182ad3a62bcc58a352402ddb3dac476bd))
* redis write-through cache for fold projections ([#2751](https://github.com/langwatch/langwatch/issues/2751)) ([6b3d058](https://github.com/langwatch/langwatch/commit/6b3d058f32c22fcf854746bb69e48fb2036f6cc4))
* register sentiment evaluator and enforce exhaustive category mapping ([#2321](https://github.com/langwatch/langwatch/issues/2321)) ([0f43f39](https://github.com/langwatch/langwatch/commit/0f43f397a9d7364b7fd44bc6ee6e3608182db730))
* release SDK radar behind PostHog feature flag ([#2419](https://github.com/langwatch/langwatch/issues/2419)) ([77e53ce](https://github.com/langwatch/langwatch/commit/77e53ce5c9dc9a61637e38fc8261ef076c9fafbd))
* replace BullMQ with event-sourcing for scenario execution ([#2954](https://github.com/langwatch/langwatch/issues/2954)) ([b4377cd](https://github.com/langwatch/langwatch/commit/b4377cd4eb3944de9738c737b1026a1a563003a1))
* rewirte dspy steps to use clickhouse ([#2499](https://github.com/langwatch/langwatch/issues/2499)) ([6fe6ec6](https://github.com/langwatch/langwatch/commit/6fe6ec6335b7ac9e90cf9ad670ea224f4c3620ad))
* **scenarios:** add OTel tracing to remaining ScenarioEventRepository methods ([#2335](https://github.com/langwatch/langwatch/issues/2335)) ([fc41384](https://github.com/langwatch/langwatch/commit/fc4138453b4357753c02297b2146061ce310a2e9))
* **scenarios:** add thinking indicator to conversation thread ([#2274](https://github.com/langwatch/langwatch/issues/2274)) ([f98545c](https://github.com/langwatch/langwatch/commit/f98545cd6d4615fb72a85bf843125cae9607547b))
* **scenarios:** add thinking indicator to conversation thread ([#2290](https://github.com/langwatch/langwatch/issues/2290)) ([f98545c](https://github.com/langwatch/langwatch/commit/f98545cd6d4615fb72a85bf843125cae9607547b))
* **scenarios:** welcome onboarding screen for first scenario ([#2466](https://github.com/langwatch/langwatch/issues/2466)) ([4cf03a9](https://github.com/langwatch/langwatch/commit/4cf03a944e60bebf6df3e5c3be22812eeb55fed4))
* **scim:** scim 2.0 server for user provisioning ([#2408](https://github.com/langwatch/langwatch/issues/2408)) ([34ce035](https://github.com/langwatch/langwatch/commit/34ce035f133b5a201da50c548f577bf6c21eb865))
* serverless clickhouse with auto-tuning and optimisations for a langwatch install + helm chart  ([#2949](https://github.com/langwatch/langwatch/issues/2949)) ([ddb722b](https://github.com/langwatch/langwatch/commit/ddb722b120c70af1747842187936f14b8895d5ca))
* shorthand syntax for labeled prompts — server-side (prompt:tag) ([#2826](https://github.com/langwatch/langwatch/issues/2826)) ([d1b59d3](https://github.com/langwatch/langwatch/commit/d1b59d3440fcc7a2d4dc3945cbf8e243b91c3d1c))
* simulation run cost/latency metrics via event sourcing ([#2538](https://github.com/langwatch/langwatch/issues/2538)) ([6aa0dfe](https://github.com/langwatch/langwatch/commit/6aa0dfe6e3c920e92dde2d411b2a587e1db96b50))
* **simulations:** faster runs, improved design, ui performance ([#2303](https://github.com/langwatch/langwatch/issues/2303)) ([0903d4a](https://github.com/langwatch/langwatch/commit/0903d4a36a967ba88368adb0bfb00aa937a5f78c))
* **skills:** add /issue skill for standardized issue creation ([#2135](https://github.com/langwatch/langwatch/issues/2135)) ([e854fc9](https://github.com/langwatch/langwatch/commit/e854fc99fc924e2dc7bac13630fca6547f51ed24))
* **skills:** agent skills-based onboarding with feature map and scenario tests ([#2377](https://github.com/langwatch/langwatch/issues/2377)) ([6f6abdb](https://github.com/langwatch/langwatch/commit/6f6abdb67b97fcb7c2958dbc193dcde37d4c82a8))
* **skynet:** comprehensive dashboard improvements for production monitoring ([#2260](https://github.com/langwatch/langwatch/issues/2260)) ([63d4443](https://github.com/langwatch/langwatch/commit/63d4443ebf39945a7a1576f5b9a5bd9ddfe0fb65))
* **suites:** ability to cancel queued/running jobs ([#2173](https://github.com/langwatch/langwatch/issues/2173)) ([cfc42d7](https://github.com/langwatch/langwatch/commit/cfc42d7c48677b4d83733940277cf3cf8c5c16b3))
* **suites:** add confirmation modal before running a suite ([#2025](https://github.com/langwatch/langwatch/issues/2025)) ([795e3ab](https://github.com/langwatch/langwatch/commit/795e3abed5a8575145aec8bf711676da9baea8da))
* **suites:** add group-by selector to All Runs page ([#1969](https://github.com/langwatch/langwatch/issues/1969)) ([c859f43](https://github.com/langwatch/langwatch/commit/c859f43db0442b7eedd5eb42c864fd873c79ae73))
* **suites:** add Select All and Clear to target picker ([#1970](https://github.com/langwatch/langwatch/issues/1970)) ([ac3f020](https://github.com/langwatch/langwatch/commit/ac3f02052e874f6b4532ed2c9f4a9d23d8e03527))
* **suites:** empty state for suites with no runs ([#2026](https://github.com/langwatch/langwatch/issues/2026)) ([7144286](https://github.com/langwatch/langwatch/commit/7144286c4c20c50122b4569a4934ddfaca52977a))
* **suites:** move Add Target and Add Scenario buttons inline with search ([#2039](https://github.com/langwatch/langwatch/issues/2039)) ([0fbd450](https://github.com/langwatch/langwatch/commit/0fbd4501f33d3b74ace7526eb6dad823b29562f4))
* **suites:** move footer row info to table header ([#2027](https://github.com/langwatch/langwatch/issues/2027)) ([1e436ce](https://github.com/langwatch/langwatch/commit/1e436ce856210a2d76301d1d63de05fe7ebac23c))
* **suites:** remove label tag pills from suites UI ([#2387](https://github.com/langwatch/langwatch/issues/2387)) ([69226e5](https://github.com/langwatch/langwatch/commit/69226e5c0c35aa82f3b0c214231ed08bc4b6389e))
* **suites:** rename Suites to Run Plans and Runs to Run History in UI ([#2285](https://github.com/langwatch/langwatch/issues/2285)) ([265e651](https://github.com/langwatch/langwatch/commit/265e6519a8eeb80a0a50720da8945ca518caf123))
* **suites:** rename Suites to Run Plans and Runs to Run History in UI ([#2320](https://github.com/langwatch/langwatch/issues/2320)) ([265e651](https://github.com/langwatch/langwatch/commit/265e6519a8eeb80a0a50720da8945ca518caf123))
* **suites:** show suite/set name on All Runs batch entries ([#2036](https://github.com/langwatch/langwatch/issues/2036)) ([8dc103b](https://github.com/langwatch/langwatch/commit/8dc103b68027e109c63bc46f45ed7b2b43f48ca8))
* **suites:** unify group-by and list/grid view across all run views ([#2038](https://github.com/langwatch/langwatch/issues/2038)) ([6ba0538](https://github.com/langwatch/langwatch/commit/6ba0538694ab14f9d733fc3acc7472f90d2f64fd))
* **suites:** unify pending jobs and completed runs into single data source ([#1979](https://github.com/langwatch/langwatch/issues/1979)) ([4988c36](https://github.com/langwatch/langwatch/commit/4988c365f439021c90b7573c62e49533a029425b))
* system-wide fold re-ordering guarantee — re-fold on out-of-order events ([#2947](https://github.com/langwatch/langwatch/issues/2947)) ([2b505a1](https://github.com/langwatch/langwatch/commit/2b505a12665fd50619d45da1277a78c22dd1b68c))
* **trace-processing:** add support for otel log and metric records to enrich span and trace data ([#2121](https://github.com/langwatch/langwatch/issues/2121)) ([aa44aeb](https://github.com/langwatch/langwatch/commit/aa44aeb9e0c77e93414492bd5ebc5b8465cb7a70))
* **traces:** add langwatch.origin attribute for trace origin classification ([#2066](https://github.com/langwatch/langwatch/issues/2066)) ([1d94865](https://github.com/langwatch/langwatch/commit/1d9486548e994d8d2f933a7f530196df8d255e43))
* **traces:** add saved views bar with origin filter infrastructure ([#2077](https://github.com/langwatch/langwatch/issues/2077)) ([68152d1](https://github.com/langwatch/langwatch/commit/68152d1879f59d68080528ed75b3cbc9a3d5e867))
* **tracing:** explicit application origin to prevent evaluation race condition ([#2325](https://github.com/langwatch/langwatch/issues/2325)) ([b11b499](https://github.com/langwatch/langwatch/commit/b11b49990bdb1ccf1bf302b9a54b442d3b6f3be3))
* **tracing:** explicit application origin to prevent evaluation race condition ([#2346](https://github.com/langwatch/langwatch/issues/2346)) ([348874e](https://github.com/langwatch/langwatch/commit/348874e48ce79537596d28887c6ed9c719200b29))
* **typescript-sdk:** add custom tag support (fetch, CRUD, list) ([#2841](https://github.com/langwatch/langwatch/issues/2841)) ([f8839ab](https://github.com/langwatch/langwatch/commit/f8839abea053e1fa1e879c27db193ee641add526))
* **typescript-sdk:** add prompt label support (fetch, assign, CRUD) ([#2781](https://github.com/langwatch/langwatch/issues/2781)) ([0ce4b34](https://github.com/langwatch/langwatch/commit/0ce4b349294bb580fd09b73005252abcf2da3c45))
* **ui:** add Lovable-style tag pills to suites and scenarios ([#1926](https://github.com/langwatch/langwatch/issues/1926)) ([58b5fa8](https://github.com/langwatch/langwatch/commit/58b5fa834c621812073de7d4825c7cecc4cd1025))
* **ui:** add reusable BetaPill wrapper component with hover popover ([#2191](https://github.com/langwatch/langwatch/issues/2191)) ([312dc07](https://github.com/langwatch/langwatch/commit/312dc07767e3cfa93c6982e4c8954fc51b8966f5))
* **usage:** add upgrade instructions to 429 rate limit messages ([#2065](https://github.com/langwatch/langwatch/issues/2065)) ([ca0b1e9](https://github.com/langwatch/langwatch/commit/ca0b1e94f7af510a4ba92ab8a3fe99df3b210305))
* **users:** add UserService and user deactivation ([#2395](https://github.com/langwatch/langwatch/issues/2395)) ([e3a2fb7](https://github.com/langwatch/langwatch/commit/e3a2fb732837462223fbf77ffdffdf6032413878))


### Bug Fixes

* accept null status field in OTLP span schema ([#2484](https://github.com/langwatch/langwatch/issues/2484)) ([b600669](https://github.com/langwatch/langwatch/commit/b6006692c012b3b7d2b6d75d77adda9727af9d84))
* add ClickHouse support for metadata.key, metadata.value, and spans.type filters ([#2381](https://github.com/langwatch/langwatch/issues/2381)) ([47ac353](https://github.com/langwatch/langwatch/commit/47ac3535c1cf3beb236e470a4fc9b5446400061d))
* add logging for unknown filter fields and prevent stuck triggers on update ([#2800](https://github.com/langwatch/langwatch/issues/2800)) ([903a48c](https://github.com/langwatch/langwatch/commit/903a48c6419c83527552764c14e67e204713cc9d))
* add missing LOW_RISK_PULL_REQUESTS.md breaking CI ([#2647](https://github.com/langwatch/langwatch/issues/2647)) ([6e20877](https://github.com/langwatch/langwatch/commit/6e2087752d0aa332f4c9480862316f48d2fa3086))
* add missing LOW_RISK_PULL_REQUESTS.md referenced by CI workflow ([6e20877](https://github.com/langwatch/langwatch/commit/6e2087752d0aa332f4c9480862316f48d2fa3086))
* add page size to trigger query ([#2378](https://github.com/langwatch/langwatch/issues/2378)) ([7aa1cc6](https://github.com/langwatch/langwatch/commit/7aa1cc6dce39a6453a016995b240ed353599443d))
* add prettier to serverExternalPackages to prevent crash ([c75276a](https://github.com/langwatch/langwatch/commit/c75276a4304ab0e6c7b4a2bf7bd14e9c18b4f662))
* add prettier to serverExternalPackages to prevent real runtime crash ([#2166](https://github.com/langwatch/langwatch/issues/2166)) ([c75276a](https://github.com/langwatch/langwatch/commit/c75276a4304ab0e6c7b4a2bf7bd14e9c18b4f662))
* add protobufjs as packageExtension for @google-cloud/dlp ([c9e315a](https://github.com/langwatch/langwatch/commit/c9e315a8e33b6d11bbb48192e44175b0d094c023)), closes [#2389](https://github.com/langwatch/langwatch/issues/2389)
* add retry with backoff for ClickHouse inserts on transient errors ([#2486](https://github.com/langwatch/langwatch/issues/2486)) ([1976c52](https://github.com/langwatch/langwatch/commit/1976c520ac5ffd86441bb0ccf2d3baee6d738708))
* add stable groupKey to EvaluationGroup for unique React keys ([#2779](https://github.com/langwatch/langwatch/issues/2779)) ([0c837f0](https://github.com/langwatch/langwatch/commit/0c837f067fbfc0ad3c6a972bc77ef538e256da0b)), closes [#1914](https://github.com/langwatch/langwatch/issues/1914)
* add structured logging for ClickHouse query failures ([#2606](https://github.com/langwatch/langwatch/issues/2606)) ([4a34c95](https://github.com/langwatch/langwatch/commit/4a34c95200e099c72206faefd126c2bb7e327312))
* add targets merge to upsertResults for event-sourcing path ([#2473](https://github.com/langwatch/langwatch/issues/2473)) ([ca766fb](https://github.com/langwatch/langwatch/commit/ca766fb46a29746546d2826dc4ffbbcfc092a0fe))
* add Vercel AI SDK streaming events to FIRST/LAST_TOKEN_EVENTS ([#2918](https://github.com/langwatch/langwatch/issues/2918)) ([41eb476](https://github.com/langwatch/langwatch/commit/41eb47637a18513c25e242999bc96dbb23455a36))
* analytics dashboard shows application traces when filtered ([#2423](https://github.com/langwatch/langwatch/issues/2423)) ([887c0db](https://github.com/langwatch/langwatch/commit/887c0db54ed10a3e05a62d86fb3cd789976c20e2))
* analytics groupBy returns empty in MCP tool and trigger alerts ([#3012](https://github.com/langwatch/langwatch/issues/3012)) ([634db38](https://github.com/langwatch/langwatch/commit/634db380de35132b6ed88ce04e3998a3229f90db))
* **analytics:** apply cardinality integer format per-series, not globally ([#2869](https://github.com/langwatch/langwatch/issues/2869)) ([63b3d1f](https://github.com/langwatch/langwatch/commit/63b3d1f7c91cea1e05eda059cb979033817660c2))
* **analytics:** cross-evaluator groupBy + metric conflict produces empty charts ([#2670](https://github.com/langwatch/langwatch/issues/2670)) ([926d88b](https://github.com/langwatch/langwatch/commit/926d88b39d9cd7aaccc6103a854328205b919b22))
* **analytics:** fix multiple chart rendering and query bugs ([#2582](https://github.com/langwatch/langwatch/issues/2582)) ([130de5c](https://github.com/langwatch/langwatch/commit/130de5c571c3cbdae138929aa1d6a38fba8dccad))
* **analytics:** resolve event metric CTE scope leak and improve thumbs display ([#2840](https://github.com/langwatch/langwatch/issues/2840)) ([9e15995](https://github.com/langwatch/langwatch/commit/9e15995171202f5aa1dee16f951748b178e2d3a5))
* **analytics:** support pipeline metrics with numeric timeScale in CH + fix circular dep ([#2152](https://github.com/langwatch/langwatch/issues/2152)) ([02f0499](https://github.com/langwatch/langwatch/commit/02f0499f4e648646ad2abb42651ef07663ba2fe8))
* **analytics:** use actual vote values for sentiment.thumbs_up_down aggregations ([#2909](https://github.com/langwatch/langwatch/issues/2909)) ([1608cfd](https://github.com/langwatch/langwatch/commit/1608cfd4549080ba4ec36456cca5937c11515e58))
* **annotations:** make ES update non-fatal to prevent 500 on annotation create/delete ([#2520](https://github.com/langwatch/langwatch/issues/2520)) ([9dbb5f0](https://github.com/langwatch/langwatch/commit/9dbb5f02b329569c58fbd78b6088b30b3608f8ff))
* auth sso updates ([#2500](https://github.com/langwatch/langwatch/issues/2500)) ([b2c54a0](https://github.com/langwatch/langwatch/commit/b2c54a065bc2fd1fcf58521795b8181ec1dfbdf5))
* auto-enable and resolve default model for first provider setup ([#1510](https://github.com/langwatch/langwatch/issues/1510)) ([8f8fb1b](https://github.com/langwatch/langwatch/commit/8f8fb1b19140fb17e810a0555a8bcdc9d0ee96c5))
* avoid OOM in getScenarioRunData ClickHouse query ([#2773](https://github.com/langwatch/langwatch/issues/2773)) ([11979ef](https://github.com/langwatch/langwatch/commit/11979efa3a0cdf6f9fb6f266f734045124ab64a5))
* avoid path shadowing in langevals CMD for readonly FS ([#2997](https://github.com/langwatch/langwatch/issues/2997)) ([921141d](https://github.com/langwatch/langwatch/commit/921141d55087505b8d213d3559152b384b0d28ee))
* batch PII detection across all string attributes in recordSpan flow ([#2524](https://github.com/langwatch/langwatch/issues/2524)) ([6131bd8](https://github.com/langwatch/langwatch/commit/6131bd873d8b30307c9d9809aa0b3505e82f24d5))
* **billing:** add hubspot lead submission on signup ([#2246](https://github.com/langwatch/langwatch/issues/2246)) ([ddd871f](https://github.com/langwatch/langwatch/commit/ddd871ffe6a3299fe4341f7dc6eb28f63062fdaf))
* **billing:** disable adaptive pricing on non-default currency ([#2363](https://github.com/langwatch/langwatch/issues/2363)) ([2e4ee7c](https://github.com/langwatch/langwatch/commit/2e4ee7cb1b8be201b0f2abdabfca38ec3393e92f))
* **billing:** prevent cancellation invoice from reactivating subscription ([#2866](https://github.com/langwatch/langwatch/issues/2866)) ([1e468c2](https://github.com/langwatch/langwatch/commit/1e468c29e94ed529b3c4078848f865601d1d827c))
* **billing:** remove message cap from growth seat event plans ([#2030](https://github.com/langwatch/langwatch/issues/2030)) ([6952673](https://github.com/langwatch/langwatch/commit/6952673ac103bc32606ee867241a1a6636f828c5))
* break circular dependency causing TDZ error on /studio ([#2153](https://github.com/langwatch/langwatch/issues/2153)) ([3643869](https://github.com/langwatch/langwatch/commit/3643869dd8154002e8e14c2d83ea2936716fe09f))
* break trace boundaries at command/reactor jobs to prevent giant traces ([#2888](https://github.com/langwatch/langwatch/issues/2888)) ([51bd600](https://github.com/langwatch/langwatch/commit/51bd600af7742c969af3b6e5a45e7aea2d3c49a5))
* bridge all LLM config params in evaluator drawer ([#2816](https://github.com/langwatch/langwatch/issues/2816)) ([c3c8b7b](https://github.com/langwatch/langwatch/commit/c3c8b7b970b9c75cc2bc1c52f351ceae93c065ab))
* broaden worktree gitignore pattern to match nested paths ([#2688](https://github.com/langwatch/langwatch/issues/2688)) ([38131a3](https://github.com/langwatch/langwatch/commit/38131a392893d41e888380de01c2431552bd75a2))
* **cancellation:** cancel-all misses prioritized jobs, stale runs stuck as running ([#2432](https://github.com/langwatch/langwatch/issues/2432)) ([7c5a7e5](https://github.com/langwatch/langwatch/commit/7c5a7e5fe67d741c9afa15275ffc41f0177d9732))
* catch-all Error→422 masks server errors in GET /api/prompts/{id} ([#2897](https://github.com/langwatch/langwatch/issues/2897)) ([0fc5453](https://github.com/langwatch/langwatch/commit/0fc5453690eeb50bd96c5688ff9a45d2ee541c28))
* center status circles on suite grid cards ([d5952fa](https://github.com/langwatch/langwatch/commit/d5952fa9e3e35fe7c8e51392dfce8d7cf1d93d4b)), closes [#1905](https://github.com/langwatch/langwatch/issues/1905)
* change AvgScoreBps to Int32 to support negative scores ([#2796](https://github.com/langwatch/langwatch/issues/2796)) ([e6b555e](https://github.com/langwatch/langwatch/commit/e6b555e78093c85e2f2110b32fe6ba1c5fb2da7f))
* check disable elasticsearch flag before queuing traces and evals ([#2493](https://github.com/langwatch/langwatch/issues/2493)) ([2b2fdec](https://github.com/langwatch/langwatch/commit/2b2fdec337a8665c45f7b840ec7cef1cabd95c84))
* checkbox groups in Add Custom Model dialog only toggle first item ([#2659](https://github.com/langwatch/langwatch/issues/2659)) ([533e604](https://github.com/langwatch/langwatch/commit/533e604266f0e157516ea2d82179750bdf903a54))
* **ci:** address free plan prompt limit in SDK E2E tests ([7a2dec5](https://github.com/langwatch/langwatch/commit/7a2dec598424dcd2ab857ba1ec5a11bad0ddb10f))
* **ci:** address free plan prompt limit in SDK tests ([#2276](https://github.com/langwatch/langwatch/issues/2276)) ([7a2dec5](https://github.com/langwatch/langwatch/commit/7a2dec598424dcd2ab857ba1ec5a11bad0ddb10f))
* classify transient ClickHouse errors as recoverable to prevent group blocking ([#2955](https://github.com/langwatch/langwatch/issues/2955)) ([9bb6d57](https://github.com/langwatch/langwatch/commit/9bb6d575a980a653d98b884edd85dd1f8301502c))
* **clickhouse:** increase connection pool to prevent stream sharing errors ([#2529](https://github.com/langwatch/langwatch/issues/2529)) ([0bf5307](https://github.com/langwatch/langwatch/commit/0bf5307ffc03734024bbb34550ea4d4e4b7626be))
* coerce empty scenarioSetId to "default" in scenario-events API ([#2604](https://github.com/langwatch/langwatch/issues/2604)) ([c2adf29](https://github.com/langwatch/langwatch/commit/c2adf29fc5decd85b9babc64ec808d9244ec8325))
* **command-bar:** lazy-load entity queries only when bar is open ([#2176](https://github.com/langwatch/langwatch/issues/2176)) ([467b12d](https://github.com/langwatch/langwatch/commit/467b12d6956f7f52afc756e5905f9b61bd9ddbb8))
* **command-bar:** lazy-load entity queries only when command bar is open ([467b12d](https://github.com/langwatch/langwatch/commit/467b12d6956f7f52afc756e5905f9b61bd9ddbb8))
* compute per-span cost and coerce string tokens ([#2523](https://github.com/langwatch/langwatch/issues/2523)) ([3c9be1d](https://github.com/langwatch/langwatch/commit/3c9be1d8c5226edba2fbab7e976af8366ef0d24e))
* **csp:** use wildcard domains for Google services ([#2421](https://github.com/langwatch/langwatch/issues/2421)) ([666fd7f](https://github.com/langwatch/langwatch/commit/666fd7f7cc894bc43feb83656c0727c12c7adc28))
* custom SDK evaluations - gray badges, stuck Processing, precondition crash ([#2234](https://github.com/langwatch/langwatch/issues/2234)) ([77cba68](https://github.com/langwatch/langwatch/commit/77cba6844de4e58a14bac4348254ef93213d4079))
* **datasets:** prevent CSV upload dialog from closing on drag-over ([#2708](https://github.com/langwatch/langwatch/issues/2708)) ([a01b593](https://github.com/langwatch/langwatch/commit/a01b5939787236c95ce11a94b3bc6bc6e6d65657)), closes [#1361](https://github.com/langwatch/langwatch/issues/1361)
* delete response_format from both normalized configs before comparison. ([ed7db97](https://github.com/langwatch/langwatch/commit/ed7db97a758e8e53fb7cb89ca6eb21702dc2d7a3))
* deleted became archived ([#2151](https://github.com/langwatch/langwatch/issues/2151)) ([89fd18e](https://github.com/langwatch/langwatch/commit/89fd18edd1debc237bfc10e2a28c81a8f1f6a330))
* **deps:** pin transitive npm deps for Dependabot high-severity alerts ([#2220](https://github.com/langwatch/langwatch/issues/2220)) ([a179da1](https://github.com/langwatch/langwatch/commit/a179da1d55859b8c9a476a6443dbfaf6bf632af3))
* **deps:** pin transitive npm deps to fix critical Dependabot alerts ([#2208](https://github.com/langwatch/langwatch/issues/2208)) ([1b1abc5](https://github.com/langwatch/langwatch/commit/1b1abc59f785bb7b0040f37fde121cd236678a5f))
* **dev:** mount mcp-server/langevals and build mcp-server in compose dev ([#3004](https://github.com/langwatch/langwatch/issues/3004)) ([60c8bfe](https://github.com/langwatch/langwatch/commit/60c8bfe13a52fcd3850829def7e7b67d871b21f7))
* dispatch finished(CANCELLED) when pool skips cancelled jobs ([#2970](https://github.com/langwatch/langwatch/issues/2970)) ([44776e7](https://github.com/langwatch/langwatch/commit/44776e736f77b8398731a48770ecceb52a2ad089))
* **docker:** worktree isolation, idempotent init, and DRY env vars ([#2834](https://github.com/langwatch/langwatch/issues/2834)) ([f924220](https://github.com/langwatch/langwatch/commit/f9242205fa4567da94a008ae64cc484d850388a5))
* **docs:** broken docs/ references after move to dev/docs/ ([#2650](https://github.com/langwatch/langwatch/issues/2650)) ([5c29d48](https://github.com/langwatch/langwatch/commit/5c29d488704eb6d4cfdfd8c95d982fe716686335))
* don't show lambda exists error ([#726](https://github.com/langwatch/langwatch/issues/726)) ([cb70e93](https://github.com/langwatch/langwatch/commit/cb70e930f60aaa70c6a4f546eea61f845c94b8b3))
* **drawers:** update drawer transparency to 80% opacity and 25px blur ([#1972](https://github.com/langwatch/langwatch/issues/1972)) ([6c05ea7](https://github.com/langwatch/langwatch/commit/6c05ea77ac3a981e96f44d17c691b5cc307fb4b4))
* ecst-based metrics sync + stale state fixes for simulation runs ([#2695](https://github.com/langwatch/langwatch/issues/2695)) ([e096373](https://github.com/langwatch/langwatch/commit/e09637383821dea255ad2136a639a5aef7655647))
* encode trace id is on processor health checkpoint ([#2534](https://github.com/langwatch/langwatch/issues/2534)) ([1e9d153](https://github.com/langwatch/langwatch/commit/1e9d153f07b76318734bc5fc51932a0bedaa46c6))
* **evaluate:** dataset dropdown hidden behind Evaluate Workflow modal ([#2181](https://github.com/langwatch/langwatch/issues/2181)) ([b96724a](https://github.com/langwatch/langwatch/commit/b96724ae861c5864eeb68743edac595309b5b054))
* **evaluate:** raise dataset dropdown z-index above modal overlay ([b96724a](https://github.com/langwatch/langwatch/commit/b96724ae861c5864eeb68743edac595309b5b054)), closes [#2179](https://github.com/langwatch/langwatch/issues/2179)
* evaluation filter returns wrong results — Nullable TraceId in correlated EXISTS ([#3005](https://github.com/langwatch/langwatch/issues/3005)) ([a75ba56](https://github.com/langwatch/langwatch/commit/a75ba565167ee2fd8b701b6c4864e090762c1c45))
* **evaluations-v3:** fix evaluator labels, HTTP validation, and default grouping ([#2936](https://github.com/langwatch/langwatch/issues/2936)) ([8700a30](https://github.com/langwatch/langwatch/commit/8700a306e76ebf6a8b60da243f03ad2769568815))
* **evaluations-v3:** show loading spinner for freshly added evaluator on run all rows ([#2218](https://github.com/langwatch/langwatch/issues/2218)) ([d50653e](https://github.com/langwatch/langwatch/commit/d50653ef8f74abc9dbfc5baccd0c7d259e7dae70))
* **evaluations:** restore inputs capture for online evaluator pipeline ([#2402](https://github.com/langwatch/langwatch/issues/2402)) ([28898f4](https://github.com/langwatch/langwatch/commit/28898f464daa61d4615e136a64f03e9408f348e7))
* **evaluations:** update list page to experiments terminology and fix navigation ([#2209](https://github.com/langwatch/langwatch/issues/2209)) ([c1da43f](https://github.com/langwatch/langwatch/commit/c1da43ff718cbb8d0880a9e4093fd64a054e8ee1))
* event-sourcing integration test failures (40/40 → 117/117) ([#2760](https://github.com/langwatch/langwatch/issues/2760)) ([f08f53c](https://github.com/langwatch/langwatch/commit/f08f53c77437fafa1c155af6f141f0a7d18de0e5))
* **event-sourcing:** enable sequential consistency for fold projection CH reads ([a3c5009](https://github.com/langwatch/langwatch/commit/a3c5009ceb224ffb8b4f16a6ebf3aef0281e4373))
* **event-sourcing:** enable sequential consistency for fold projections ([#2259](https://github.com/langwatch/langwatch/issues/2259)) ([a3c5009](https://github.com/langwatch/langwatch/commit/a3c5009ceb224ffb8b4f16a6ebf3aef0281e4373))
* exclude real_time experiments from license experiment count ([#2572](https://github.com/langwatch/langwatch/issues/2572)) ([f970e18](https://github.com/langwatch/langwatch/commit/f970e188cde5c82f577e6502384607196c150a76))
* exclude ScenarioRole Map columns from trace_summaries SELECT to prevent OOM ([#2667](https://github.com/langwatch/langwatch/issues/2667)) ([98fa762](https://github.com/langwatch/langwatch/commit/98fa7625746681ead7e97d59ec10aa745d94c89b))
* **experiments:** display human-readable run names instead of raw IDs ([#2336](https://github.com/langwatch/langwatch/issues/2336)) ([11c570d](https://github.com/langwatch/langwatch/commit/11c570de76bc6c32f812c3f510826bbb8f8722a7))
* **export:** apply traceIds filter when exporting selected traces ([#2503](https://github.com/langwatch/langwatch/issues/2503)) ([9c001c3](https://github.com/langwatch/langwatch/commit/9c001c3f7532f8e663332e68a6670699cd87d2d8))
* extract events from spans in ClickHouse trace mapper ([#2984](https://github.com/langwatch/langwatch/issues/2984)) ([1b6ed22](https://github.com/langwatch/langwatch/commit/1b6ed22c10e620de4c8f18d62b7b8a0e9a41c044))
* extract trace input from JSON wrapper keys in new OTLP flow ([#2504](https://github.com/langwatch/langwatch/issues/2504)) ([14b158f](https://github.com/langwatch/langwatch/commit/14b158fdec00f071e4e0a66d974662eee17f14e5))
* fail fast on worker startup if database is unreachable ([#2969](https://github.com/langwatch/langwatch/issues/2969)) ([2bd02a2](https://github.com/langwatch/langwatch/commit/2bd02a286d8a9cea825b064960ed8acd1555bac6))
* filter evaluation analytics to only processed runs, fix category evaluator No data ([#2636](https://github.com/langwatch/langwatch/issues/2636)) ([abccdbc](https://github.com/langwatch/langwatch/commit/abccdbc3efa1d9596e0e7e15fdc25a037f9ae4eb))
* forward scrollId in messages pagination to fix stuck navigation after page 2 ([#2850](https://github.com/langwatch/langwatch/issues/2850)) ([7a3ea60](https://github.com/langwatch/langwatch/commit/7a3ea60a3f93bfa6a1b3290da7d25f25a8808ec9))
* gate code agents from suite target picker ([#2825](https://github.com/langwatch/langwatch/issues/2825)) ([4e41e27](https://github.com/langwatch/langwatch/commit/4e41e2720d86005ccd1aa762b13d3ec47dd9a3c3))
* grant cost visibility to API key-authenticated requests ([#2431](https://github.com/langwatch/langwatch/issues/2431)) ([bb5febf](https://github.com/langwatch/langwatch/commit/bb5febf269ae742a7dfaad9bfa3e7c423dfcec38))
* guard against refetches overwriting edits and prune nested empty filters ([5911420](https://github.com/langwatch/langwatch/commit/5911420a10a0960df3823b6120e386a63af4d285))
* guard Edit Filters drawer against refetch overwrites and nested empty filters ([#2776](https://github.com/langwatch/langwatch/issues/2776)) ([5911420](https://github.com/langwatch/langwatch/commit/5911420a10a0960df3823b6120e386a63af4d285))
* handle gzip/deflate compression in OTEL v1 endpoints ([#2471](https://github.com/langwatch/langwatch/issues/2471)) ([4f3d267](https://github.com/langwatch/langwatch/commit/4f3d2673d8d3686905a3234cf902eafe379db3e2))
* handle openai.responses/ prefix and dated models in cost matching ([#2677](https://github.com/langwatch/langwatch/issues/2677)) ([0230c03](https://github.com/langwatch/langwatch/commit/0230c03b80fb9d0263c7e7bbed8d2115d304a4fe))
* harden all ClickHouse queries against OOM ([#2605](https://github.com/langwatch/langwatch/issues/2605)) ([e8fbc8c](https://github.com/langwatch/langwatch/commit/e8fbc8c108c3ba0ee4c246e2035ea3621c8842ab))
* harden private dataplane routing against data leakage and config errors ([#2543](https://github.com/langwatch/langwatch/issues/2543)) ([edf6412](https://github.com/langwatch/langwatch/commit/edf64122614a3551f340dc3823fc2d48591ea423))
* hide Open Thread button when scenario run not yet processed ([#2540](https://github.com/langwatch/langwatch/issues/2540)) ([720cc14](https://github.com/langwatch/langwatch/commit/720cc14ba704bf9e089dbb7fc695dd915ba087cd))
* hide restricted actions from lite members across UI ([#2655](https://github.com/langwatch/langwatch/issues/2655)) ([892f720](https://github.com/langwatch/langwatch/commit/892f72073c47a1ac8b392f2be004d2a0103a2a57))
* hide restricted settings sidebar items from lite members ([#2721](https://github.com/langwatch/langwatch/issues/2721)) ([398057c](https://github.com/langwatch/langwatch/commit/398057cb572b601539c880fe3791e03373563dcf))
* improve healthcheck reliability and fix I/O extraction for OTEL traces ([#2476](https://github.com/langwatch/langwatch/issues/2476)) ([1f1d62f](https://github.com/langwatch/langwatch/commit/1f1d62f5561bb09e63b7b3e0bb1cd44c837b3de0))
* improve LLM model cost matching, token estimation, and regex generation ([#2564](https://github.com/langwatch/langwatch/issues/2564)) ([2b3e559](https://github.com/langwatch/langwatch/commit/2b3e55993cbae0a52ea6bf161d0392bd378c52c3))
* include evaluations in /api/traces/search response ([#2829](https://github.com/langwatch/langwatch/issues/2829)) ([7b6d4d2](https://github.com/langwatch/langwatch/commit/7b6d4d2804b92ccd8adeb9cb97fa8aba224ebc9d))
* include version.txt in skills publish sync ([#2417](https://github.com/langwatch/langwatch/issues/2417)) ([1cd6606](https://github.com/langwatch/langwatch/commit/1cd66066a90984530059eef502d29359c14bf0ea))
* increase free plan project limit to 2, fix dataset drawer tab submission, and float selection bar ([53bb580](https://github.com/langwatch/langwatch/commit/53bb5809cda940360bf0e3ba72951489d4b4dc97))
* increase free plan project limit, fix dataset drawer tabs, float selection bar ([#2392](https://github.com/langwatch/langwatch/issues/2392)) ([53bb580](https://github.com/langwatch/langwatch/commit/53bb5809cda940360bf0e3ba72951489d4b4dc97))
* limit ui errors instead of silently swallowing ([#2574](https://github.com/langwatch/langwatch/issues/2574)) ([60a9a89](https://github.com/langwatch/langwatch/commit/60a9a890d1a206d9b4ce47b5d2d6045b8057418a))
* lite member UI restrictions and minor UI fixes ([#2678](https://github.com/langwatch/langwatch/issues/2678)) ([97c6e94](https://github.com/langwatch/langwatch/commit/97c6e942d7775716fea970048b081e83bb1a9ce5))
* make Docker images compatible with readOnlyRootFilesystem ([#2986](https://github.com/langwatch/langwatch/issues/2986)) ([9fc7f80](https://github.com/langwatch/langwatch/commit/9fc7f80e35002b7799fb5047b98d316262528028))
* **mcp:** align prompt tool schemas with backend API ([#2326](https://github.com/langwatch/langwatch/issues/2326)) ([65279f3](https://github.com/langwatch/langwatch/commit/65279f38687bae5c7dc7a13db33dcb2f7d135397))
* **mcp:** build config and create-mcp-server with tsup to fix dual-module bug ([640c2e4](https://github.com/langwatch/langwatch/commit/640c2e42024cc40b0b02c1abac4cf07f6881f497))
* **mcp:** build mcp-server before pnpm install — remove symlink hack ([#2989](https://github.com/langwatch/langwatch/issues/2989)) ([8a2b76d](https://github.com/langwatch/langwatch/commit/8a2b76d87bb9d193cf8830ac82243018ad6d9d00))
* **mcp:** build mcp-server before pnpm install to eliminate symlink hack ([8a2b76d](https://github.com/langwatch/langwatch/commit/8a2b76d87bb9d193cf8830ac82243018ad6d9d00))
* **mcp:** build subexports with tsup to eliminate dual-module bug ([#2985](https://github.com/langwatch/langwatch/issues/2985)) ([640c2e4](https://github.com/langwatch/langwatch/commit/640c2e42024cc40b0b02c1abac4cf07f6881f497))
* **mcp:** copy langevals evaluators file before mcp-server build ([d17d616](https://github.com/langwatch/langwatch/commit/d17d616e23dbfd803b9b5bf59229af0c45ac22c8))
* **mcp:** copy langevals file before mcp-server build in Docker ([#2990](https://github.com/langwatch/langwatch/issues/2990)) ([d17d616](https://github.com/langwatch/langwatch/commit/d17d616e23dbfd803b9b5bf59229af0c45ac22c8))
* **mcp:** fetch spans for ClickHouse traces in search_traces ([#2222](https://github.com/langwatch/langwatch/issues/2222)) ([f52c82c](https://github.com/langwatch/langwatch/commit/f52c82c91a76bd2e0e98ae50edf2698af97f9c78))
* **mcp:** fetch spans for ClickHouse traces when includeSpans is true ([f52c82c](https://github.com/langwatch/langwatch/commit/f52c82c91a76bd2e0e98ae50edf2698af97f9c78))
* **mcp:** resolve dual-module config bug causing "Config not initialized" in production ([fcf0e0b](https://github.com/langwatch/langwatch/commit/fcf0e0b0f85bfc6b10a26ac917fe2c3f0335771d))
* **mcp:** resolve dual-module config bug in production ([#2956](https://github.com/langwatch/langwatch/issues/2956)) ([fcf0e0b](https://github.com/langwatch/langwatch/commit/fcf0e0b0f85bfc6b10a26ac917fe2c3f0335771d))
* **mcp:** resolve get_trace 404 and search_traces metadata filter bugs ([#2214](https://github.com/langwatch/langwatch/issues/2214)) ([a0362e6](https://github.com/langwatch/langwatch/commit/a0362e60aa54e7c6e5dac9f241b206f4f4cd0b5f))
* **mcp:** use compact summary digest for search_traces ([#2237](https://github.com/langwatch/langwatch/issues/2237)) ([21093e0](https://github.com/langwatch/langwatch/commit/21093e0c061cc660168f18faccd8d8b9cbbcc482))
* migrate /api/thread/[id] from Elasticsearch to ClickHouse ([#2958](https://github.com/langwatch/langwatch/issues/2958)) ([b9fdc23](https://github.com/langwatch/langwatch/commit/b9fdc235d678d9467adac391fefe4b4f46a3b5af))
* migration format that for some reason worked locally against dev ([#2125](https://github.com/langwatch/langwatch/issues/2125)) ([af267ff](https://github.com/langwatch/langwatch/commit/af267ff3f08e8f554495eca685d6f3edd0eff484))
* model costs showing $0 for models with date suffixes or -latest ([#2890](https://github.com/langwatch/langwatch/issues/2890)) ([6abe0bb](https://github.com/langwatch/langwatch/commit/6abe0bbbae59c98d078699ffff71a953d85f1609))
* monotonic UpdatedAt for all fold handlers to prevent merge collisions ([bdcdb12](https://github.com/langwatch/langwatch/commit/bdcdb12389d96096a3efd6914a86294f8ddbdc28))
* monotonic UpdatedAt for experiment_runs fold to prevent FinishedAt loss ([#2743](https://github.com/langwatch/langwatch/issues/2743)) ([23f8ca8](https://github.com/langwatch/langwatch/commit/23f8ca89b4c27e4aa39c542ba7f06d769645d1d3))
* monotonic UpdatedAt for trace_summaries fold to prevent span data loss ([#2732](https://github.com/langwatch/langwatch/issues/2732)) ([aac9611](https://github.com/langwatch/langwatch/commit/aac96116a9611eec2557189b75269dadf228cda6))
* monotonic UpdatedAt to prevent merge collisions with identical timestamps ([#2731](https://github.com/langwatch/langwatch/issues/2731)) ([bdcdb12](https://github.com/langwatch/langwatch/commit/bdcdb12389d96096a3efd6914a86294f8ddbdc28))
* move prisma from devDependencies to dependencies ([#2965](https://github.com/langwatch/langwatch/issues/2965)) ([918643c](https://github.com/langwatch/langwatch/commit/918643c5f9a0330d64a46c81493ffa20fab60452))
* move tag CRUD from /api/orgs/:orgId/prompt-tags to /api/prompts/tags ([#2911](https://github.com/langwatch/langwatch/issues/2911)) ([dc14851](https://github.com/langwatch/langwatch/commit/dc148515a05bf346e310f9ddd3d6e39f8d11aea8))
* move tsx from devDependencies to dependencies ([#2962](https://github.com/langwatch/langwatch/issues/2962)) ([43b315c](https://github.com/langwatch/langwatch/commit/43b315c5347c059adb1caa28b064bdc9e0bf2634))
* **nlp:** regenerate uv.lock to resolve litellm version conflict ([#2397](https://github.com/langwatch/langwatch/issues/2397)) ([6e38b5d](https://github.com/langwatch/langwatch/commit/6e38b5d4fc667d863e1730edea999078ac444179)), closes [#2396](https://github.com/langwatch/langwatch/issues/2396)
* normalize empty ScenarioSetId to 'default' in listing queries ([#2717](https://github.com/langwatch/langwatch/issues/2717)) ([2bb8ce8](https://github.com/langwatch/langwatch/commit/2bb8ce89fd3a066874d45003cd0ab3b8464ae2c2))
* normalize metadata attributes and support trace.* alias ([#2740](https://github.com/langwatch/langwatch/issues/2740)) ([a252ee6](https://github.com/langwatch/langwatch/commit/a252ee60557fa4bb43500bb2eb9ee27266bb54eb))
* normalize ScenarioSetId in getDistinctExternalSetIds ([#2723](https://github.com/langwatch/langwatch/issues/2723)) ([2750e69](https://github.com/langwatch/langwatch/commit/2750e692ee0441577874fa50ab71be49c9683168))
* normalize ScenarioSetId in getRunDataForAllSuites ([#2722](https://github.com/langwatch/langwatch/issues/2722)) ([c3559e2](https://github.com/langwatch/langwatch/commit/c3559e2ee9b1b3d13ffd8a8d82ef740b53abbfc9))
* normalize scenarioSetId in SSE filter ([#2724](https://github.com/langwatch/langwatch/issues/2724)) ([460af2e](https://github.com/langwatch/langwatch/commit/460af2e6a70e44ba4e44bc0c62c9e00f7807fd2e))
* normalize scenarioSetId in SSE filter to match empty string with default ([460af2e](https://github.com/langwatch/langwatch/commit/460af2e6a70e44ba4e44bc0c62c9e00f7807fd2e)), closes [#2720](https://github.com/langwatch/langwatch/issues/2720)
* **nurturing:** first_prompt_created only on first prompt ([#2685](https://github.com/langwatch/langwatch/issues/2685)) ([5bf930a](https://github.com/langwatch/langwatch/commit/5bf930a40e14e58ed728d4d3ea425a73525de8d3))
* **nurturing:** only fire first_prompt_created on actual first prompt ([5bf930a](https://github.com/langwatch/langwatch/commit/5bf930a40e14e58ed728d4d3ea425a73525de8d3))
* origin filter must also match literal 'application' string ([887c0db](https://github.com/langwatch/langwatch/commit/887c0db54ed10a3e05a62d86fb3cd789976c20e2))
* **plans:** hide discontinued pricing notice for free plan users ([#2146](https://github.com/langwatch/langwatch/issues/2146)) ([359de13](https://github.com/langwatch/langwatch/commit/359de13f1a41160283746d4873284625a98e6f6c))
* **playground:** handle null maxTokens when opening trace in Playground ([#1847](https://github.com/langwatch/langwatch/issues/1847)) ([524bb28](https://github.com/langwatch/langwatch/commit/524bb28c08d41af068f3d3315b3c34caea5a43bc))
* prefer LANGWATCH_ENDPOINT over BASE_HOST for scenario runner ([#3007](https://github.com/langwatch/langwatch/issues/3007)) ([26d1708](https://github.com/langwatch/langwatch/commit/26d1708fe0571875bfcec7acc550609dbcaa41c6))
* preserve monitor card structure when no evaluation data ([#2828](https://github.com/langwatch/langwatch/issues/2828)) ([f9e91f3](https://github.com/langwatch/langwatch/commit/f9e91f3f633d74722358e474cf2b4fb3d5087419))
* prettier in turbopack again ([#2167](https://github.com/langwatch/langwatch/issues/2167)) ([ff4b71a](https://github.com/langwatch/langwatch/commit/ff4b71aa484fd80e21979e4a1208924955eca986))
* prevent ClickHouse OOM on trace listing query ([#2422](https://github.com/langwatch/langwatch/issues/2422)) ([7724d1d](https://github.com/langwatch/langwatch/commit/7724d1d900e75484483cc6c061bd2efb3a7b77b7))
* prevent forward sync from overwriting dirty form values in studio ([#2807](https://github.com/langwatch/langwatch/issues/2807)) ([2831695](https://github.com/langwatch/langwatch/commit/283169584673772d514e78fcb4b59310ab2321b2))
* prevent metrics_computed from reverting simulation run terminal status ([#2730](https://github.com/langwatch/langwatch/issues/2730)) ([47c4721](https://github.com/langwatch/langwatch/commit/47c4721b4557f6363e40c1c68b1b6b33472d44da))
* prevent studio drawer from opening when dragging nodes ([#2549](https://github.com/langwatch/langwatch/issues/2549)) ([514bf07](https://github.com/langwatch/langwatch/commit/514bf07a7901d1ae4916bf79dea491081ddbd8a4))
* projection issues brought up from migrations ([#2075](https://github.com/langwatch/langwatch/issues/2075)) ([e5e8cf6](https://github.com/langwatch/langwatch/commit/e5e8cf614e2e954396b5c8521dbeecaeba618b14))
* **projection-replay:** use dynamic imports for CJS/ESM interop on Node 24 ([#2922](https://github.com/langwatch/langwatch/issues/2922)) ([928b255](https://github.com/langwatch/langwatch/commit/928b255461684c57d2edb9b33448e905f9ca8f7f))
* **projection-replay:** use dynamic imports for CJS→ESM interop on Node 24 ([928b255](https://github.com/langwatch/langwatch/commit/928b255461684c57d2edb9b33448e905f9ca8f7f))
* **prompts:** coerce trace LLM params in Open in Prompts flow ([#2210](https://github.com/langwatch/langwatch/issues/2210)) ([1737c35](https://github.com/langwatch/langwatch/commit/1737c35c1a631693338cb31083728e99466c864d))
* **prompts:** coerce trace LLM params to numbers in "Open in Prompts" flow ([1737c35](https://github.com/langwatch/langwatch/commit/1737c35c1a631693338cb31083728e99466c864d))
* **prompts:** include same-ms siblings and fix ClickHouse StartTime type ([#2875](https://github.com/langwatch/langwatch/issues/2875)) ([01a6ff3](https://github.com/langwatch/langwatch/commit/01a6ff339c9a454269ba12bb9929567145c33269))
* **prompts:** pin 'input' variable first in sorted inputs list ([#2232](https://github.com/langwatch/langwatch/issues/2232)) ([eec9c87](https://github.com/langwatch/langwatch/commit/eec9c8757d0e73f1bf62ef9666edd91705ba7bcc))
* **prompts:** pin "input" variable first in sorted inputs list ([eec9c87](https://github.com/langwatch/langwatch/commit/eec9c8757d0e73f1bf62ef9666edd91705ba7bcc))
* **prompts:** prevent false diffs in prompt sync creating unnecessary versions ([#2212](https://github.com/langwatch/langwatch/issues/2212)) ([153bdb7](https://github.com/langwatch/langwatch/commit/153bdb75c986822e8c38f0442f9d2092e2f812e6))
* **prompts:** prevent version history popover re-opening on page reload ([#2273](https://github.com/langwatch/langwatch/issues/2273)) ([23531f4](https://github.com/langwatch/langwatch/commit/23531f4469a284e1a78a52e897cad75289e571d1))
* **prompts:** search siblings for prompt reference, not just parents ([#2842](https://github.com/langwatch/langwatch/issues/2842)) ([eeda5f9](https://github.com/langwatch/langwatch/commit/eeda5f974957f1622791712afa540f6d27bbaa0b))
* **prompts:** strip response_format from comparison to prevent false diffs ([ed7db97](https://github.com/langwatch/langwatch/commit/ed7db97a758e8e53fb7cb89ca6eb21702dc2d7a3))
* **prompts:** strip response_format from sync comparison to prevent false diffs ([#2224](https://github.com/langwatch/langwatch/issues/2224)) ([ed7db97](https://github.com/langwatch/langwatch/commit/ed7db97a758e8e53fb7cb89ca6eb21702dc2d7a3))
* prune unnecessary columns from ClickHouse analytics queries ([#2556](https://github.com/langwatch/langwatch/issues/2556)) ([ef7304e](https://github.com/langwatch/langwatch/commit/ef7304e6b32fc83a6f944a0ed647b27f81ff36e2))
* **python-sdk:** make langchain-core an optional dependency ([#2464](https://github.com/langwatch/langwatch/issues/2464)) ([cde8406](https://github.com/langwatch/langwatch/commit/cde8406990f5e19af98048a43a0d7d9782553a48))
* quorum writes for simulation_runs fold to prevent replication lag stale reads ([#2728](https://github.com/langwatch/langwatch/issues/2728)) ([d2203b4](https://github.com/langwatch/langwatch/commit/d2203b4364328965e284081ea96dccc9d02379b6))
* redirect pycache to /tmp for readonly filesystem compat ([#2994](https://github.com/langwatch/langwatch/issues/2994)) ([42be8d8](https://github.com/langwatch/langwatch/commit/42be8d807d21951ded10708645567e1c32a62bc5))
* reduce NLP CI OpenAI spend by scoping triggers and using gpt-5-mini ([#2978](https://github.com/langwatch/langwatch/issues/2978)) ([24f662c](https://github.com/langwatch/langwatch/commit/24f662cfdfa6ec75fc04998a84a35e84f7a94fa8))
* reduce Redis CPU from GroupQueue dispatch loop ([#2488](https://github.com/langwatch/langwatch/issues/2488)) ([e72e0d6](https://github.com/langwatch/langwatch/commit/e72e0d6d09f2569f575aa48fb41e4fda2d646f90))
* reject unknown automation filter fields and fail-closed in evaluation ([#2791](https://github.com/langwatch/langwatch/issues/2791)) ([96db60e](https://github.com/langwatch/langwatch/commit/96db60e98e26b2e987c353bef76b87412ca3e257)), closes [#2786](https://github.com/langwatch/langwatch/issues/2786)
* remove dead cost-checker code from worker paths ([#2609](https://github.com/langwatch/langwatch/issues/2609)) ([1d1c167](https://github.com/langwatch/langwatch/commit/1d1c16750f140ce49cb548fec5c5f11aed67e794))
* remove dead cost-checker code from worker paths ([#2661](https://github.com/langwatch/langwatch/issues/2661)) ([1d1c167](https://github.com/langwatch/langwatch/commit/1d1c16750f140ce49cb548fec5c5f11aed67e794))
* remove quickwit check from start.sh ([#2966](https://github.com/langwatch/langwatch/issues/2966)) ([a1773ed](https://github.com/langwatch/langwatch/commit/a1773edf97f139231b6b61da905974c8f28c0ac6))
* remove redundant _parent: zero entries from SpanCosts Map column ([#2738](https://github.com/langwatch/langwatch/issues/2738)) ([f208bba](https://github.com/langwatch/langwatch/commit/f208bba780f4311e9524cea9c26fd04ee29435c4))
* remove runtime prisma generate from start scripts ([#2979](https://github.com/langwatch/langwatch/issues/2979)) ([6292948](https://github.com/langwatch/langwatch/commit/629294868ec7fb7713c32db2fc1b4b4154623cd4))
* remove safeTruncate from evaluation and collector paths ([#2487](https://github.com/langwatch/langwatch/issues/2487)) ([#2573](https://github.com/langwatch/langwatch/issues/2573)) ([ab59104](https://github.com/langwatch/langwatch/commit/ab59104c60405610a3dfe5b63ac087278250e121))
* remove select_sequential_consistency from CH reads ([#2899](https://github.com/langwatch/langwatch/issues/2899)) ([9ab3f26](https://github.com/langwatch/langwatch/commit/9ab3f263bbd96d54a09a61bd4ada494959649420))
* rename remaining "Suite" UI labels to "Run Plan" ([#2285](https://github.com/langwatch/langwatch/issues/2285)) ([30ffd75](https://github.com/langwatch/langwatch/commit/30ffd750a08543611036b1353bc8d723daa97495))
* rename remaining Suite UI labels to Run Plan ([#2480](https://github.com/langwatch/langwatch/issues/2480)) ([30ffd75](https://github.com/langwatch/langwatch/commit/30ffd750a08543611036b1353bc8d723daa97495))
* repair broken unit tests after fold projection and command refactoring ([#2754](https://github.com/langwatch/langwatch/issues/2754)) ([98fdad1](https://github.com/langwatch/langwatch/commit/98fdad13c96d7b8f42225d83d193e03194070081))
* replace CreatedAt with OccurredAt for trace_summaries date filtering ([1194b10](https://github.com/langwatch/langwatch/commit/1194b10aa86abeef2febd21f42c9e05a3a70f1d3))
* replace EXISTS subqueries with IN to avoid ClickHouse planner crash ([#2662](https://github.com/langwatch/langwatch/issues/2662)) ([7a48b22](https://github.com/langwatch/langwatch/commit/7a48b22ee9843da634bbdae317d83e3507165410))
* replace heavy LIMIT 1 BY dedup in trace, stats, and clustering queries ([#2792](https://github.com/langwatch/langwatch/issues/2792)) ([e68ccde](https://github.com/langwatch/langwatch/commit/e68ccde25f89a2b2d3333306abdd09e297ea6e03))
* replace SELECT * with explicit columns in topic clustering query ([#2654](https://github.com/langwatch/langwatch/issues/2654)) ([a03e688](https://github.com/langwatch/langwatch/commit/a03e688d5cc0c02531c663065565e5c748c10691))
* replace start+complete with single reportEvaluation command for custom SDK evals ([#2242](https://github.com/langwatch/langwatch/issues/2242)) ([2657706](https://github.com/langwatch/langwatch/commit/265770673113b53c73955e02821cdf0dd38eaf4d))
* replace two-step evaluation events with single reportEvaluation ([#2248](https://github.com/langwatch/langwatch/issues/2248)) ([05a90b3](https://github.com/langwatch/langwatch/commit/05a90b3d625d1276a80a309312b5e0d2235e9a87))
* resolve Edit Filters drawer animation glitch on automations page ([#2775](https://github.com/langwatch/langwatch/issues/2775)) ([e8cfc1d](https://github.com/langwatch/langwatch/commit/e8cfc1d018760ff0c70c6c9cf6f0c747853d0818)), closes [#2774](https://github.com/langwatch/langwatch/issues/2774)
* resolve internal set ID handling bugs ([#2348](https://github.com/langwatch/langwatch/issues/2348)) ([371785d](https://github.com/langwatch/langwatch/commit/371785d0918c7310951240673b928b3c15593d2b))
* resolve protobufjs/minimal for @google-cloud/dlp ([#2393](https://github.com/langwatch/langwatch/issues/2393)) ([c9e315a](https://github.com/langwatch/langwatch/commit/c9e315a8e33b6d11bbb48192e44175b0d094c023))
* resolve TOCTOU race in GroupQueue dedup and implement extend/replace flags ([119f2e3](https://github.com/langwatch/langwatch/commit/119f2e35d1aad5f3e4690ddf7c50c2626627c70b))
* resolve TOCTOU race in GroupQueue dedup, implement extend/replace ([#2735](https://github.com/langwatch/langwatch/issues/2735)) ([119f2e3](https://github.com/langwatch/langwatch/commit/119f2e35d1aad5f3e4690ddf7c50c2626627c70b))
* resolve typecheck errors in clickhouse-trace-dedup integration test ([5401012](https://github.com/langwatch/langwatch/commit/5401012791fc0f0c31ba9993782b641139503507))
* resolve typecheck errors in trace dedup test ([#2814](https://github.com/langwatch/langwatch/issues/2814)) ([5401012](https://github.com/langwatch/langwatch/commit/5401012791fc0f0c31ba9993782b641139503507))
* restore Chakra default shadows for light mode ([#2533](https://github.com/langwatch/langwatch/issues/2533)) ([195d76b](https://github.com/langwatch/langwatch/commit/195d76becc6712a4ebd3e7d3ab160e3500c24dce))
* restore Chakra default shadows for proper light mode depth ([195d76b](https://github.com/langwatch/langwatch/commit/195d76becc6712a4ebd3e7d3ab160e3500c24dce))
* restore event-sourcing infrastructure regressed by [#2734](https://github.com/langwatch/langwatch/issues/2734) ([#2873](https://github.com/langwatch/langwatch/issues/2873)) ([a81fbde](https://github.com/langwatch/langwatch/commit/a81fbdedb3d015e27d2d44523bcc3e74bbde6b9d))
* restore setMaxListeners(128) for production ([#2963](https://github.com/langwatch/langwatch/issues/2963)) ([ee5a551](https://github.com/langwatch/langwatch/commit/ee5a5515f5cf2c0ce1e9ef90ff665042e5413279))
* restrict 'Add members' button and team Admin role to org admins only ([58f86d9](https://github.com/langwatch/langwatch/commit/58f86d959d0e39dcb7a6660ab3af39de3c735f16))
* restrict 'Add members' button and team role options to org admins only ([#2580](https://github.com/langwatch/langwatch/issues/2580)) ([58f86d9](https://github.com/langwatch/langwatch/commit/58f86d959d0e39dcb7a6660ab3af39de3c735f16))
* round float values before ClickHouse insert in trace_summaries ([#2676](https://github.com/langwatch/langwatch/issues/2676)) ([0aae663](https://github.com/langwatch/langwatch/commit/0aae6634a3b8d7d0338a11535d0d8a7a939c6fc6))
* route fold store to ClickHouse primary replica for read-after-write consistency ([#2729](https://github.com/langwatch/langwatch/issues/2729)) ([70179fb](https://github.com/langwatch/langwatch/commit/70179fbe0c7480d264298480eef02d25269f19c7))
* route trace fold store to primary replica for read-after-write consistency ([#2737](https://github.com/langwatch/langwatch/issues/2737)) ([f4d75d4](https://github.com/langwatch/langwatch/commit/f4d75d452544c3ae076910e0b496f65d7515343a))
* run prisma generate at container startup ([#2967](https://github.com/langwatch/langwatch/issues/2967)) ([192c789](https://github.com/langwatch/langwatch/commit/192c789a0055e48a91a40506c9c43e640298e771))
* run prisma generate before workers start ([#2968](https://github.com/langwatch/langwatch/issues/2968)) ([1bf4b3d](https://github.com/langwatch/langwatch/commit/1bf4b3d2357eb0add459d133fbcb9e7fd54e5019))
* scenario AI generator fails with Azure provider ([#2931](https://github.com/langwatch/langwatch/issues/2931)) ([6f05077](https://github.com/langwatch/langwatch/commit/6f05077d8ea914cc9050a4ef87857c21fd58adbd))
* scenario events 404 — ClickHouse client resolved with "unknown" tenantId ([#2571](https://github.com/langwatch/langwatch/issues/2571)) ([#2570](https://github.com/langwatch/langwatch/issues/2570)) ([dfb6caf](https://github.com/langwatch/langwatch/commit/dfb6caff558f7f52408934685a3fe42973f255f0))
* **scenarios:** add missing Metadata column to ClickHouse dedup subquery ([#2406](https://github.com/langwatch/langwatch/issues/2406)) ([8633ae6](https://github.com/langwatch/langwatch/commit/8633ae6b7211f7f59d784ef535984912d3c522b3))
* **scenarios:** add QUEUED to cancellable statuses and route ad-hoc runs through queueRun ([#2458](https://github.com/langwatch/langwatch/issues/2458)) ([f277f5f](https://github.com/langwatch/langwatch/commit/f277f5f88e083dcd4b6d3e2f0f6a3b93ab2255b2)), closes [#2452](https://github.com/langwatch/langwatch/issues/2452)
* **scenarios:** auto-update suites UI on dedupe via SSE invalidation ([#2257](https://github.com/langwatch/langwatch/issues/2257)) ([6922d25](https://github.com/langwatch/langwatch/commit/6922d256ebaa77d451ce926a06f3e906f4f24e98)), closes [#2255](https://github.com/langwatch/langwatch/issues/2255)
* **scenarios:** convert welcome screen from page to modal ([#2548](https://github.com/langwatch/langwatch/issues/2548)) ([e91d09e](https://github.com/langwatch/langwatch/commit/e91d09e238c63d43f372f7ee93d9b91c0fbcab8a))
* **scenarios:** include hostname in 'Unable to resolve hostname' errors ([#2536](https://github.com/langwatch/langwatch/issues/2536)) ([0a623e5](https://github.com/langwatch/langwatch/commit/0a623e5c858022f68ce20677a4d7dcc86cb1f245))
* **scenarios:** pass pre-assigned run ID to SDK to prevent duplicate grid entries ([#2250](https://github.com/langwatch/langwatch/issues/2250)) ([cde304a](https://github.com/langwatch/langwatch/commit/cde304a876b182b23c67ab21a877866ab4b6af38))
* **scenarios:** propagate full metadata through ClickHouse pipeline ([#2349](https://github.com/langwatch/langwatch/issues/2349)) ([b4aafd1](https://github.com/langwatch/langwatch/commit/b4aafd1af0f0d604e5dcafc0a4c6065d432794d7))
* **scenarios:** use pre-assigned scenarioRunId in failure handler ([#2268](https://github.com/langwatch/langwatch/issues/2268)) ([ae47e07](https://github.com/langwatch/langwatch/commit/ae47e07ae46fccdc0e6f5e17482d009e55c77488))
* **scenarios:** use pre-assigned scenarioRunId in failure handler to prevent duplicates ([ae47e07](https://github.com/langwatch/langwatch/commit/ae47e07ae46fccdc0e6f5e17482d009e55c77488))
* scope challenge skill to conversation context ([#2613](https://github.com/langwatch/langwatch/issues/2613)) ([77ed677](https://github.com/langwatch/langwatch/commit/77ed6776d62d8108442a6b4c5ac152b7f711d592))
* scope evaluation filter evaluator pickers by result type ([#2910](https://github.com/langwatch/langwatch/issues/2910)) ([7777e66](https://github.com/langwatch/langwatch/commit/7777e66a311fd4700ee6ef2a6f0fd347ee447d26))
* scroll behavior broken on scenario run detail drawer ([#2546](https://github.com/langwatch/langwatch/issues/2546)) ([6a241ff](https://github.com/langwatch/langwatch/commit/6a241ff5c29e9a28ea20e4b27ad2b8cbb3803506))
* **sdk+skills:** widen peer deps, fix scenario config, strengthen skill tests ([#2485](https://github.com/langwatch/langwatch/issues/2485)) ([c77237c](https://github.com/langwatch/langwatch/commit/c77237c8f5690f4eafcc96ed3334e3c6d61a7249))
* **security:** address critical CodeQL code scanning alerts ([#2172](https://github.com/langwatch/langwatch/issues/2172)) ([17875d4](https://github.com/langwatch/langwatch/commit/17875d416ddc4f625c0cab94793459ab8f293cc8))
* **security:** address high-severity CodeQL code scanning alerts ([#2197](https://github.com/langwatch/langwatch/issues/2197)) ([0d5090a](https://github.com/langwatch/langwatch/commit/0d5090acc8c7cd3fd374b4bff3a3c239a057d653))
* **security:** address medium-severity CodeQL code scanning alerts ([#2200](https://github.com/langwatch/langwatch/issues/2200)) ([c6c9add](https://github.com/langwatch/langwatch/commit/c6c9add24a1504efe625bd53715025471028fb70))
* **security:** bump critical Dependabot vulnerabilities (unstructured + nltk) ([#2275](https://github.com/langwatch/langwatch/issues/2275)) ([cc1f004](https://github.com/langwatch/langwatch/commit/cc1f004d2ec710c9eaaa762e336516d447338090))
* **security:** bump moderate/low severity vulnerabilities in python-sdk ([#2299](https://github.com/langwatch/langwatch/issues/2299)) ([da288b2](https://github.com/langwatch/langwatch/commit/da288b2559e01e0af6046c19eec39eb3d4678d77))
* serialize primitive arrays in drawer URL instead of ephemeral complexProps ([#2886](https://github.com/langwatch/langwatch/issues/2886)) ([4765dda](https://github.com/langwatch/langwatch/commit/4765dda64cf0dfd6293567b9b430c13e4a40d1c7))
* short-circuit dead cost queries, batch TriggerSent IN clause, add Cost index ([#2603](https://github.com/langwatch/langwatch/issues/2603)) ([7672438](https://github.com/langwatch/langwatch/commit/767243896a243e1b6de0daf1630e574c63b29617)), closes [#2597](https://github.com/langwatch/langwatch/issues/2597)
* show error state when analytics charts fail ([#2608](https://github.com/langwatch/langwatch/issues/2608)) ([deb1979](https://github.com/langwatch/langwatch/commit/deb197931bb49509c4ba2617e7c9ea2a7942e1cc))
* **sidebar:** align Chat and Support labels with Settings ([#2420](https://github.com/langwatch/langwatch/issues/2420)) ([d911f78](https://github.com/langwatch/langwatch/commit/d911f782d3d002caaf5972d274df1b85e2235e1c))
* **simulations:** add ClickHouse partition pruning to listing pages ([#2188](https://github.com/langwatch/langwatch/issues/2188)) ([da70f88](https://github.com/langwatch/langwatch/commit/da70f8847ba2199dd4810aae89ad9c8af6c2be49))
* **simulations:** add StartedAt WHERE for detail page partition pruning ([#2194](https://github.com/langwatch/langwatch/issues/2194)) ([634c73a](https://github.com/langwatch/langwatch/commit/634c73af102e210fb95c7310bdd20b03fce12590))
* **simulations:** use useSimulationRouter for set navigation ([#2302](https://github.com/langwatch/langwatch/issues/2302)) ([5407fb9](https://github.com/langwatch/langwatch/commit/5407fb9d41676cca677cbcd5122302ea566242e9))
* **simulations:** use useSimulationRouter for set navigation to avoid query param contamination ([5407fb9](https://github.com/langwatch/langwatch/commit/5407fb9d41676cca677cbcd5122302ea566242e9)), closes [#2297](https://github.com/langwatch/langwatch/issues/2297)
* **skills:** update MCP config schema for Claude Code compatibility ([#2927](https://github.com/langwatch/langwatch/issues/2927)) ([f85cf4e](https://github.com/langwatch/langwatch/commit/f85cf4e8ad67c518c1cb0f2ba830a6ad8ed00acc))
* skip litellm_bot test on RateLimitError from Cerebras ([#2355](https://github.com/langwatch/langwatch/issues/2355)) ([76bf87f](https://github.com/langwatch/langwatch/commit/76bf87f1db51b0fab681c593cd5515c66d0908f1))
* skip retries for non-retryable errors and fix bytesValue JSON round-trip ([#2489](https://github.com/langwatch/langwatch/issues/2489)) ([00f5851](https://github.com/langwatch/langwatch/commit/00f5851d6239498dfaec03481dc9d63268e8fd62))
* **skynet:** reduce memory from 18GB to ~200MB by streaming group data ([#2182](https://github.com/langwatch/langwatch/issues/2182)) ([940651b](https://github.com/langwatch/langwatch/commit/940651b44eccb23a97cc7f19be30797e92049856))
* small ui fix for longer scenario status ([5880720](https://github.com/langwatch/langwatch/commit/588072036915e73b6aca034597d9ba942f95037f))
* soften SSO enforcement and improve invite accept flow ([#2612](https://github.com/langwatch/langwatch/issues/2612)) ([562b197](https://github.com/langwatch/langwatch/commit/562b197e3c9675980bd018ebbe59cadb25c0529b))
* sort thread messages chronologically in ClickHouse path ([#2621](https://github.com/langwatch/langwatch/issues/2621)) ([400b1b7](https://github.com/langwatch/langwatch/commit/400b1b74fb118ae4a349b09eb8be35ab447188dc))
* span canonicalisation output fixes, and trace/thread level + override level timeout fixes ([#2055](https://github.com/langwatch/langwatch/issues/2055)) ([252076c](https://github.com/langwatch/langwatch/commit/252076c97828c1fbc6d1ad6f3a49f5b0c1e59b15))
* **studio:** handle evaluation_state_change message type on client ([#2184](https://github.com/langwatch/langwatch/issues/2184)) ([3dbdc56](https://github.com/langwatch/langwatch/commit/3dbdc564935190efd5dd4fc24072567950ab54e3)), closes [#2180](https://github.com/langwatch/langwatch/issues/2180)
* **studio:** make Evaluate button responsive by moving version state to store ([#2319](https://github.com/langwatch/langwatch/issues/2319)) ([307dc20](https://github.com/langwatch/langwatch/commit/307dc20bee96c16f67174c6442024703ead117be))
* **studio:** persist evaluation results across page refresh ([#2334](https://github.com/langwatch/langwatch/issues/2334)) ([bb9f71b](https://github.com/langwatch/langwatch/commit/bb9f71bd8905689b4fdb7de0e56e18dc430016f2))
* **studio:** play button menu hidden behind drawer ([#2186](https://github.com/langwatch/langwatch/issues/2186)) ([6c439b4](https://github.com/langwatch/langwatch/commit/6c439b449a507be167b2d2cd687255e75e34115d))
* **studio:** prevent edge disconnection and improve workflow state hygiene ([#2213](https://github.com/langwatch/langwatch/issues/2213)) ([e5765c1](https://github.com/langwatch/langwatch/commit/e5765c1e5274b8cd803a1e661df58f5b7e2f53a1))
* **studio:** prevent evaluator node from duplicating input handles on reload ([#2360](https://github.com/langwatch/langwatch/issues/2360)) ([be1e00b](https://github.com/langwatch/langwatch/commit/be1e00b6cc3767c17c9532f87bc9a2a096dabee0)), closes [#2329](https://github.com/langwatch/langwatch/issues/2329)
* **studio:** prevent false validation error and infinite spinner in evaluate workflow ([#2190](https://github.com/langwatch/langwatch/issues/2190)) ([e4c954f](https://github.com/langwatch/langwatch/commit/e4c954fc054c1278a78ca0d919441d892447b6df))
* **studio:** publish hang, import version, sticky evaluator details ([#2481](https://github.com/langwatch/langwatch/issues/2481)) ([7cda5e5](https://github.com/langwatch/langwatch/commit/7cda5e52e38e07bebc68242b4cea38c329fb2ead)), closes [#2474](https://github.com/langwatch/langwatch/issues/2474)
* **studio:** resolve SSE stream hanging when post_event completes without done event ([#2202](https://github.com/langwatch/langwatch/issues/2202)) ([1c05137](https://github.com/langwatch/langwatch/commit/1c05137cbf0aa77a5da1d6e5f4c484e201de79af))
* **studio:** update edges and parameter refs when renaming a node ([#2198](https://github.com/langwatch/langwatch/issues/2198)) ([2f187a3](https://github.com/langwatch/langwatch/commit/2f187a3d2a64c2cf68fca553bd761ad1f7aad1ab))
* **suites:** drawer navigation, table width, and quick-run callbacks ([#1956](https://github.com/langwatch/langwatch/issues/1956)) ([#1974](https://github.com/langwatch/langwatch/issues/1974)) ([cbc866a](https://github.com/langwatch/langwatch/commit/cbc866af841ed9ce5ff8acee06910cf3536b630d))
* **suites:** hide cancel buttons by default, reveal on hover ([#2461](https://github.com/langwatch/langwatch/issues/2461)) ([52f1352](https://github.com/langwatch/langwatch/commit/52f1352ca938f64aff3fe0d1475cc6fe86fd2eb0))
* **suites:** nested drawer typing not working ([#2037](https://github.com/langwatch/langwatch/issues/2037)) ([6dac123](https://github.com/langwatch/langwatch/commit/6dac1237f33e772d87d06e1666ee6abbfa40e3bc))
* **suites:** open child drawers as nested overlays instead of navigating ([#1973](https://github.com/langwatch/langwatch/issues/1973)) ([4767bb4](https://github.com/langwatch/langwatch/commit/4767bb40366dd70d91ed6050aa5df47a8974c765))
* **suites:** remove non-functional triggers section from new suite form ([#2147](https://github.com/langwatch/langwatch/issues/2147)) ([77cb79f](https://github.com/langwatch/langwatch/commit/77cb79fc0c960b6852acc373e60aff35e50f4aaa))
* **suites:** remove non-functional triggers section from new suite form ([#2154](https://github.com/langwatch/langwatch/issues/2154)) ([77cb79f](https://github.com/langwatch/langwatch/commit/77cb79fc0c960b6852acc373e60aff35e50f4aaa))
* **suites:** remove redundant pass/fail label display ([#2292](https://github.com/langwatch/langwatch/issues/2292)) ([a7a2013](https://github.com/langwatch/langwatch/commit/a7a2013c7f96f185e72602fdea34e39c19a57863))
* **suites:** remove stale x/n format from header counts and sidebar ([#2239](https://github.com/langwatch/langwatch/issues/2239)) ([33a1de8](https://github.com/langwatch/langwatch/commit/33a1de883de25a4917b69111f014db4b41dcac4d)), closes [#2236](https://github.com/langwatch/langwatch/issues/2236)
* **suites:** replace percentage with passed/failed status labels ([#1987](https://github.com/langwatch/langwatch/issues/1987)) ([a6a43b9](https://github.com/langwatch/langwatch/commit/a6a43b974bfaf3efea2d53314ebbcd31d30eeca4))
* **suites:** replace percentage with passed/failed status labels ([#2028](https://github.com/langwatch/langwatch/issues/2028)) ([a6a43b9](https://github.com/langwatch/langwatch/commit/a6a43b974bfaf3efea2d53314ebbcd31d30eeca4))
* **suites:** restore word labels, fix layout wrapping, remove redundant status icon ([#2357](https://github.com/langwatch/langwatch/issues/2357)) ([ececd53](https://github.com/langwatch/langwatch/commit/ececd53357cb69d9a81123eb3b01e056d3e41fdf))
* **suites:** save & run not triggering, missing cancel buttons ([#2537](https://github.com/langwatch/langwatch/issues/2537)) ([348fa8c](https://github.com/langwatch/langwatch/commit/348fa8c6b8076dea328a9eee9aca3b35f1fab4f9))
* **suites:** sort external sets by most recent run in sidebar ([#2294](https://github.com/langwatch/langwatch/issues/2294)) ([083fb0a](https://github.com/langwatch/langwatch/commit/083fb0af17f063d66d86636fb38a7e3f50f86faa)), closes [#2280](https://github.com/langwatch/langwatch/issues/2280)
* **suites:** stop target selector dropdown from closing Run Scenario modal ([#2137](https://github.com/langwatch/langwatch/issues/2137)) ([4226f3f](https://github.com/langwatch/langwatch/commit/4226f3fbe2fc75d4f9b39d23acb7cdbbd1e812f5))
* **suites:** traces drawer cannot be closed from suites/run ([#2291](https://github.com/langwatch/langwatch/issues/2291)) ([3cb1aec](https://github.com/langwatch/langwatch/commit/3cb1aecc68ac4a3a3978988b0d3e868f3cfccee5))
* **suites:** use drawer navigation consistently, fix table width, add quick-run callbacks ([cbc866a](https://github.com/langwatch/langwatch/commit/cbc866af841ed9ce5ff8acee06910cf3536b630d)), closes [#1956](https://github.com/langwatch/langwatch/issues/1956)
* summary charts with groupBy render blank ([#2646](https://github.com/langwatch/langwatch/issues/2646)) ([082a995](https://github.com/langwatch/langwatch/commit/082a995944b207d2f1a5af42a67407b79f81fcb9))
* support both event structures for stale events ([#2048](https://github.com/langwatch/langwatch/issues/2048)) ([cfb9ece](https://github.com/langwatch/langwatch/commit/cfb9ece94d3e7b30d688c6e7e11a803abffedaa8))
* sync custom SDK evaluations to ClickHouse evaluation_runs table ([#2168](https://github.com/langwatch/langwatch/issues/2168)) ([4840649](https://github.com/langwatch/langwatch/commit/4840649bedd23454c56e9c4d7adaa5eeb16348df))
* **test:** assert cursor resets when period changes ([#1833](https://github.com/langwatch/langwatch/issues/1833)) ([61a4141](https://github.com/langwatch/langwatch/commit/61a41416750b9de7ee67c1cb660a26d2cb8b5ac6))
* **test:** assert cursor resets when period changes ([#1846](https://github.com/langwatch/langwatch/issues/1846)) ([61a4141](https://github.com/langwatch/langwatch/commit/61a41416750b9de7ee67c1cb660a26d2cb8b5ac6))
* trace details drawer cannot be closed ([#2238](https://github.com/langwatch/langwatch/issues/2238)) ([5cae1c9](https://github.com/langwatch/langwatch/commit/5cae1c9e8677e4933a886cf5dea026ecee2780e5))
* trace details drawer cannot be closed in scenario run detail ([5cae1c9](https://github.com/langwatch/langwatch/commit/5cae1c9e8677e4933a886cf5dea026ecee2780e5)), closes [#2201](https://github.com/langwatch/langwatch/issues/2201)
* **tracer:** replace dead code guard with contexts.length check in getRAGInfo ([#2690](https://github.com/langwatch/langwatch/issues/2690)) ([4214cea](https://github.com/langwatch/langwatch/commit/4214cea2627b23f6d3d5681babc9a6d59885544c))
* **traces:** add token estimation to event-sourcing pipeline ([#2050](https://github.com/langwatch/langwatch/issues/2050)) ([ecb641f](https://github.com/langwatch/langwatch/commit/ecb641fe337910af6f9f632cba00162ae49c9e62))
* **traces:** restore pagination controls on Traces tab ([#2133](https://github.com/langwatch/langwatch/issues/2133)) ([1ff7402](https://github.com/langwatch/langwatch/commit/1ff7402eac7c73fa341ac1bbe8d0d2d7e8feb652))
* triggers failing when fetching too many traces at once ([#2495](https://github.com/langwatch/langwatch/issues/2495)) ([6ba24ab](https://github.com/langwatch/langwatch/commit/6ba24abd8b388cfebff6a9805b4b0a1c358d34ea))
* triggers not firing + fixed sentiment and eval analytics on ClickHouse ([#2364](https://github.com/langwatch/langwatch/issues/2364)) ([cf3400d](https://github.com/langwatch/langwatch/commit/cf3400d182c010e34f059a96e5f3bcf9f54cdba5))
* ttlCache Redis key collision causing empty scenario set IDs ([#2945](https://github.com/langwatch/langwatch/issues/2945)) ([3dbd5b9](https://github.com/langwatch/langwatch/commit/3dbd5b9d7df183e17b1b109e59476d3be3f9528d))
* typescript scenario trace span types, role cost propagation, and model cost matching ([#2763](https://github.com/langwatch/langwatch/issues/2763)) ([72c9c8a](https://github.com/langwatch/langwatch/commit/72c9c8acfbc5338a2dd233cc92587a2338fafec2))
* **ui:** add overflow scrolling to ExpandedTextDialog for large content ([#1015](https://github.com/langwatch/langwatch/issues/1015)) ([949e111](https://github.com/langwatch/langwatch/commit/949e1111ea9e22d4775306aea80c90c79204ca3c))
* **ui:** add overflow scrolling to ExpandedTextDialog for large content ([#1849](https://github.com/langwatch/langwatch/issues/1849)) ([949e111](https://github.com/langwatch/langwatch/commit/949e1111ea9e22d4775306aea80c90c79204ca3c))
* **ui:** adding litemember ui changes ([#2521](https://github.com/langwatch/langwatch/issues/2521)) ([bb97be8](https://github.com/langwatch/langwatch/commit/bb97be8fd1f61e686db645faecf564ebe947f65f))
* **ui:** beta pill tooltip works on every hover, not just first ([#2414](https://github.com/langwatch/langwatch/issues/2414)) ([e1360b0](https://github.com/langwatch/langwatch/commit/e1360b0966efe11b7f42640eba0646cb5c6a0a35))
* **ui:** center "Create your first evaluation" button in empty state ([f0850fe](https://github.com/langwatch/langwatch/commit/f0850fecf6390544c6104f6991893abdc01b85bc))
* **ui:** center empty state button on evaluations page ([#2462](https://github.com/langwatch/langwatch/issues/2462)) ([f0850fe](https://github.com/langwatch/langwatch/commit/f0850fecf6390544c6104f6991893abdc01b85bc))
* **ui:** fix optimizer dropdown hidden behind optimize modal ([#2469](https://github.com/langwatch/langwatch/issues/2469)) ([a7045ff](https://github.com/langwatch/langwatch/commit/a7045ffc338d464e3425c7d03ba63634b0270ca9))
* **ui:** fix optimizer dropdown hidden behind optimize modal ([#2470](https://github.com/langwatch/langwatch/issues/2470)) ([a7045ff](https://github.com/langwatch/langwatch/commit/a7045ffc338d464e3425c7d03ba63634b0270ca9))
* **ui:** fix select dropdowns hidden behind Add Members modal ([#2468](https://github.com/langwatch/langwatch/issues/2468)) ([3708c34](https://github.com/langwatch/langwatch/commit/3708c34f4b839304735dc4f2d191306fdd574e7d))
* **ui:** global z-index fix for dropdowns behind modals ([#2547](https://github.com/langwatch/langwatch/issues/2547)) ([8f6b851](https://github.com/langwatch/langwatch/commit/8f6b8515a11ef6fc759db948367adb93485e2a6f))
* **ui:** hide sync checkbox with single split, prevent date range crash ([#2745](https://github.com/langwatch/langwatch/issues/2745)) ([6c788da](https://github.com/langwatch/langwatch/commit/6c788da3fba2026259c4eb73ce8a6d0c32d887f8))
* **ui:** replace hardcoded colors with semantic tokens for dark mode ([#2459](https://github.com/langwatch/langwatch/issues/2459)) ([5f93ab3](https://github.com/langwatch/langwatch/commit/5f93ab37fa577d40e77cba993c977881b424eed1))
* **ui:** sort experiment runs sidebar newest-first ([#2463](https://github.com/langwatch/langwatch/issues/2463)) ([f1588d4](https://github.com/langwatch/langwatch/commit/f1588d450dee2f16fbdb81eb42268affb7e25c80))
* **ui:** truncate long metadata values and fix popover arrows ([#2056](https://github.com/langwatch/langwatch/issues/2056)) ([be97f16](https://github.com/langwatch/langwatch/commit/be97f168e19b623b7c489fa7d5592e8549800e89))
* update ~45 broken docs/ references to dev/docs/ after docs move ([5c29d48](https://github.com/langwatch/langwatch/commit/5c29d488704eb6d4cfdfd8c95d982fe716686335)), closes [#2648](https://github.com/langwatch/langwatch/issues/2648)
* update clickHouse trace service ignores scrollId from options ([#2615](https://github.com/langwatch/langwatch/issues/2615)) ([70399c0](https://github.com/langwatch/langwatch/commit/70399c0dfb597852b6858126d3a10111e8d26a55))
* update llm metric showing inflated cost and tokens due to span JOIN fan-out ([#2839](https://github.com/langwatch/langwatch/issues/2839)) ([4135828](https://github.com/langwatch/langwatch/commit/4135828979ca89068b5b2deb47c7675ef83c3ea1))
* update ttlReconciler test to include new tables ([#2617](https://github.com/langwatch/langwatch/issues/2617)) ([27b9054](https://github.com/langwatch/langwatch/commit/27b90542c2e2ce3c619cf06bc2bd080bb26c5f6f))
* updated billable event list ([#2047](https://github.com/langwatch/langwatch/issues/2047)) ([7ef76ef](https://github.com/langwatch/langwatch/commit/7ef76ef04b9debef81f4df355cd13be704beaa4d))
* use composite key in EvaluationGroupList to prevent React key collisions ([#2765](https://github.com/langwatch/langwatch/issues/2765)) ([523f461](https://github.com/langwatch/langwatch/commit/523f46163e9f3855dce948f4530fbbda79ab4d56))
* use config.projectId for label assignment in prompt API ([#2793](https://github.com/langwatch/langwatch/issues/2793)) ([397067e](https://github.com/langwatch/langwatch/commit/397067e23bd3299c6339b0ce07ac9737b4b760c8))
* use correct langwatch.origin.source attribute key in hoistSource ([#2739](https://github.com/langwatch/langwatch/issues/2739)) ([383db59](https://github.com/langwatch/langwatch/commit/383db59fcecabf25bfdc5e1fbc514589ee014607))
* use ECR pull-through cache for aws-lambda-adapter image ([#2727](https://github.com/langwatch/langwatch/issues/2727)) ([d781c75](https://github.com/langwatch/langwatch/commit/d781c75d2080cf3c28deb482347858b594ccdb49))
* use LANGWATCH_ENDPOINT for scenario runner instead of BASE_HOST ([26d1708](https://github.com/langwatch/langwatch/commit/26d1708fe0571875bfcec7acc550609dbcaa41c6))
* use non-nullable UpdatedAt for evaluation_runs TTL column ([#2759](https://github.com/langwatch/langwatch/issues/2759)) ([65b7f53](https://github.com/langwatch/langwatch/commit/65b7f536ef5878a178a292d04c5f44c776093581))
* use project model provider for hardcoded translation  ([#2846](https://github.com/langwatch/langwatch/issues/2846)) ([3170f96](https://github.com/langwatch/langwatch/commit/3170f961228a98faa2136279e7fcd7937f30c9e9))
* use single source for first-message check on messages page ([#2502](https://github.com/langwatch/langwatch/issues/2502)) ([f5684c7](https://github.com/langwatch/langwatch/commit/f5684c70ce73aca84a2b5db3f0c7ce68518a039f))
* use tool mode for AI scenario generation to prevent schema mismatch ([#2542](https://github.com/langwatch/langwatch/issues/2542)) ([8f2131c](https://github.com/langwatch/langwatch/commit/8f2131cee4e65f18a34ee80037fe9d8fd1a9e4ae)), closes [#2284](https://github.com/langwatch/langwatch/issues/2284)
* use trace_summaries.TokensPerSecond to avoid ClickHouse OOM on TPS metrics ([#2656](https://github.com/langwatch/langwatch/issues/2656)) ([89108fb](https://github.com/langwatch/langwatch/commit/89108fb138702b646302d6f193103379623ea4ff))
* use venv python directly for langevals readonly FS compat ([#2991](https://github.com/langwatch/langwatch/issues/2991)) ([e320131](https://github.com/langwatch/langwatch/commit/e32013170324a0ad90b527f36b851cb663edeb57))
* use venv python directly for langevals readOnlyRootFilesystem compat ([e320131](https://github.com/langwatch/langwatch/commit/e32013170324a0ad90b527f36b851cb663edeb57))
* vertically center status circles on suite cards ([#2006](https://github.com/langwatch/langwatch/issues/2006)) ([d5952fa](https://github.com/langwatch/langwatch/commit/d5952fa9e3e35fe7c8e51392dfce8d7cf1d93d4b))
* wire projectMetadata reactor into trace-processing pipeline ([#2424](https://github.com/langwatch/langwatch/issues/2424)) ([922e2c7](https://github.com/langwatch/langwatch/commit/922e2c7b4baea7bf259fd9e045ac6921848e7f0d))
* **workflow:** model dropdown doesn't open in workflow LLM block ([#2391](https://github.com/langwatch/langwatch/issues/2391)) ([7b3c353](https://github.com/langwatch/langwatch/commit/7b3c35323a57c078c878f84569b0a168500778cc))
* **workflow:** model dropdown doesn't open inside studio drawer ([#2407](https://github.com/langwatch/langwatch/issues/2407)) ([a9de4b0](https://github.com/langwatch/langwatch/commit/a9de4b040187082d33dc33a92b908edbcf85a56c)), closes [#2390](https://github.com/langwatch/langwatch/issues/2390)
* **workflow:** use controlled popover for model selector inside drawer ([7b3c353](https://github.com/langwatch/langwatch/commit/7b3c35323a57c078c878f84569b0a168500778cc)), closes [#2390](https://github.com/langwatch/langwatch/issues/2390)
* write scenario events to clickhouse before elasticsearch ([#2254](https://github.com/langwatch/langwatch/issues/2254)) ([d043ef4](https://github.com/langwatch/langwatch/commit/d043ef494b4e3b18fb2bee75002286b174a5edea))


### Miscellaneous

* add PII guard to create-issue skill and kanban board skill ([#2560](https://github.com/langwatch/langwatch/issues/2560)) ([f93c018](https://github.com/langwatch/langwatch/commit/f93c018e26883821486695538a7034f6c6230d93))
* add PII guard, kanban skill, and orchestrate PR lifecycle ([#2563](https://github.com/langwatch/langwatch/issues/2563)) ([a370a63](https://github.com/langwatch/langwatch/commit/a370a6364ed8b0bec2ba7c3ab1d12f8ec69050c1))
* add Prometheus metrics for event sourcing pipeline ([#2891](https://github.com/langwatch/langwatch/issues/2891)) ([cbfba32](https://github.com/langwatch/langwatch/commit/cbfba32b1ee0e99f1c6419316a102cc02edae04b))
* clean up dead config and agent bloat ([#2669](https://github.com/langwatch/langwatch/issues/2669)) ([c6164c8](https://github.com/langwatch/langwatch/commit/c6164c866ccd4d838a2d5ed33752e2fb8f86b097))
* clean up dead config and agent bloat ([#2671](https://github.com/langwatch/langwatch/issues/2671)) ([c6164c8](https://github.com/langwatch/langwatch/commit/c6164c866ccd4d838a2d5ed33752e2fb8f86b097))
* **deps:** batch safe JS dependency bumps (Tier 1a) ([#2169](https://github.com/langwatch/langwatch/issues/2169)) ([8b5b891](https://github.com/langwatch/langwatch/commit/8b5b8915941f19ca07019b330e276f01ae3bface))
* **deps:** bump @chakra-ui/react from 3.29.0 to 3.34.0 in /langwatch ([#2114](https://github.com/langwatch/langwatch/issues/2114)) ([74d59d3](https://github.com/langwatch/langwatch/commit/74d59d3e1e34a78dd318221963e25cf098326747))
* **deps:** bump @hookform/resolvers 3→5 and react-hook-form 7.47→7.55 ([#2024](https://github.com/langwatch/langwatch/issues/2024)) ([65b6eaf](https://github.com/langwatch/langwatch/commit/65b6eaf222112408332adf7ce286577e2ef7f4fb))
* **main:** release clickhouse-serverless 0.2.0 ([#2980](https://github.com/langwatch/langwatch/issues/2980)) ([af8aaba](https://github.com/langwatch/langwatch/commit/af8aabaa75302603254bf93732306a50bb83e264))
* **main:** release python-sdk 0.14.0 ([#1641](https://github.com/langwatch/langwatch/issues/1641)) ([c9c7f71](https://github.com/langwatch/langwatch/commit/c9c7f716895dca6734c6d660c54f3303574f0ebe))
* **main:** release python-sdk 0.15.0 ([#2119](https://github.com/langwatch/langwatch/issues/2119)) ([0d09034](https://github.com/langwatch/langwatch/commit/0d0903421bc9ad4a6bb8f5f5e7fa539d3c3b68b6))
* **main:** release python-sdk 0.16.0 ([#2231](https://github.com/langwatch/langwatch/issues/2231)) ([c01e2fa](https://github.com/langwatch/langwatch/commit/c01e2fa3f1c3b0ed536856f942e22012af502e01))
* **main:** release python-sdk 0.17.0 ([#2343](https://github.com/langwatch/langwatch/issues/2343)) ([3621515](https://github.com/langwatch/langwatch/commit/36215154d608193522daca80a3c3a72cd1c7bd78))
* **main:** release skills 0.2.0 ([#2416](https://github.com/langwatch/langwatch/issues/2416)) ([b43557a](https://github.com/langwatch/langwatch/commit/b43557a7444864f6e54017726d1b318bb170ea6b))
* remove generic review agents and skill ([#2895](https://github.com/langwatch/langwatch/issues/2895)) ([949dcfd](https://github.com/langwatch/langwatch/commit/949dcfd71eb15edf0a0b80eab0edf4e22c5a5c82))
* remove reactor for satisfaction score ([#2189](https://github.com/langwatch/langwatch/issues/2189)) ([44c3894](https://github.com/langwatch/langwatch/commit/44c3894120f66c5c8b31ab7c5699b60c6a364aa0))
* **scenarios:** pre-compile child process to eliminate tsx cold-start ([#2271](https://github.com/langwatch/langwatch/issues/2271)) ([0f80091](https://github.com/langwatch/langwatch/commit/0f800919af300d70c1c88d1782e7199fc8500231))
* **scenarios:** use full 'scenario' prefix and KSUID for scenario IDs ([#2157](https://github.com/langwatch/langwatch/issues/2157)) ([dbf7ef0](https://github.com/langwatch/langwatch/commit/dbf7ef0796deec6a6c23b46e8b8e40c51c9bde4f))
* send traces to clickhouse first, then elasticsearch ([#2301](https://github.com/langwatch/langwatch/issues/2301)) ([900b97f](https://github.com/langwatch/langwatch/commit/900b97f10d6df520ef1e37d791c3f9d0f0760b3d))
* **skills:** add data seeding step to browser-test and improve chore detection ([#2266](https://github.com/langwatch/langwatch/issues/2266)) ([e19ed8f](https://github.com/langwatch/langwatch/commit/e19ed8fb01f83e3275abe73b996e80a5459abaaa))
* support running without Elasticsearch ([#2852](https://github.com/langwatch/langwatch/issues/2852)) ([044c34b](https://github.com/langwatch/langwatch/commit/044c34be2871579da2c812cc5679f449a99a6d5c))
* switch default evaluator model from gpt-5 to gpt-5-mini ([#2340](https://github.com/langwatch/langwatch/issues/2340)) ([5749849](https://github.com/langwatch/langwatch/commit/57498498a9e8dd578ba72c97b1a97ed1bbb2f376))
* sync model registry ([f956e22](https://github.com/langwatch/langwatch/commit/f956e229117f1b00715af91ae0312f8a602f264b))
* sync model registry ([11597b3](https://github.com/langwatch/langwatch/commit/11597b31d3e99efffd200aa5fd9959b92a46cfdc))
* sync model registry ([1233820](https://github.com/langwatch/langwatch/commit/12338201cfcf3946f9cb12c294f282aede5b2b6f))
* sync model registry (338 models) ([#2384](https://github.com/langwatch/langwatch/issues/2384)) ([1233820](https://github.com/langwatch/langwatch/commit/12338201cfcf3946f9cb12c294f282aede5b2b6f))
* sync model registry (341 models) ([#2762](https://github.com/langwatch/langwatch/issues/2762)) ([11597b3](https://github.com/langwatch/langwatch/commit/11597b31d3e99efffd200aa5fd9959b92a46cfdc))
* sync model registry (343 models) ([#2950](https://github.com/langwatch/langwatch/issues/2950)) ([f956e22](https://github.com/langwatch/langwatch/commit/f956e229117f1b00715af91ae0312f8a602f264b))
* update onboarding to use new otlp exporter ([#2498](https://github.com/langwatch/langwatch/issues/2498)) ([80142fe](https://github.com/langwatch/langwatch/commit/80142fe0c911471e5448fc3cc20ed8b28c74849a))
* update orchestrate skill to use drive-pr ([#2328](https://github.com/langwatch/langwatch/issues/2328)) ([19dcdf1](https://github.com/langwatch/langwatch/commit/19dcdf1bfa5842d1ad18fc590e709346ab192d81))
* update orchestrate skill to use drive-pr and remove commit-push skill ([19dcdf1](https://github.com/langwatch/langwatch/commit/19dcdf1bfa5842d1ad18fc590e709346ab192d81))


### Documentation

* add .claude/ and specs/ as low-risk paths ([#2139](https://github.com/langwatch/langwatch/issues/2139)) ([9d6ef1d](https://github.com/langwatch/langwatch/commit/9d6ef1d0a784cb6eef166ca8c964442d1db65d94)), closes [#2138](https://github.com/langwatch/langwatch/issues/2138)
* add common mistake for string-assertion regression tests ([#2663](https://github.com/langwatch/langwatch/issues/2663)) ([5aa1284](https://github.com/langwatch/langwatch/commit/5aa12849efc448a05cab28f448cb7165fbd1596b))
* add Liquid Template Syntax to docs nav and improve discoverability ([#2710](https://github.com/langwatch/langwatch/issues/2710)) ([8528d9c](https://github.com/langwatch/langwatch/commit/8528d9ce96e4818671b8cf9a895b1cfca0ae0eb4))
* enforce mandatory test coverage, feature file parity, and [@regression](https://github.com/regression) tag ([#2620](https://github.com/langwatch/langwatch/issues/2620)) ([56a088b](https://github.com/langwatch/langwatch/commit/56a088b72d21f3b7c1cf2fe488c1d662c6fb7c4a))
* harden regression test and review instructions for test level matching ([#2665](https://github.com/langwatch/langwatch/issues/2665)) ([c333907](https://github.com/langwatch/langwatch/commit/c3339077e5934191954830b5014a29b77b07452e))
* harden regression test instructions for test level matching ([#2664](https://github.com/langwatch/langwatch/issues/2664)) ([5aa1284](https://github.com/langwatch/langwatch/commit/5aa12849efc448a05cab28f448cb7165fbd1596b))
* link 20 orphaned pages into docs navigation ([#2756](https://github.com/langwatch/langwatch/issues/2756)) ([253a468](https://github.com/langwatch/langwatch/commit/253a468c786109093abd2a66ebe8837976af519f))
* move docs to the main repo ([4f019b7](https://github.com/langwatch/langwatch/commit/4f019b7579c80896a4f3847e4ab1b3ec0c08b33c))
* put also the recipe skills in the skills directory ([d79babf](https://github.com/langwatch/langwatch/commit/d79babf28dc4d5dbfc640ffe44b3119c12d858a6))
* update Mastra integration for latest observability API ([1170b37](https://github.com/langwatch/langwatch/commit/1170b37229f67b18e85b8a5b4c328bb238e8d205))


### Code Refactoring

* **billing:** billing services upgrade ([#2240](https://github.com/langwatch/langwatch/issues/2240)) ([ce13d8e](https://github.com/langwatch/langwatch/commit/ce13d8e484479b277f767fca7b8bf9d7512babe4))
* **billing:** slack notification when people reach limits ([#2059](https://github.com/langwatch/langwatch/issues/2059)) ([aacd48c](https://github.com/langwatch/langwatch/commit/aacd48c41d043d405cc094b5c3d1dbba45cbb8e9))
* consolidate span cost computation into model-cost-matching module ([#2694](https://github.com/langwatch/langwatch/issues/2694)) ([1bfa250](https://github.com/langwatch/langwatch/commit/1bfa250aeb82b62cb004c78336e40fa03f9adc67))
* decompose traceSummary fold into domain services ([#2769](https://github.com/langwatch/langwatch/issues/2769)) ([c6696d3](https://github.com/langwatch/langwatch/commit/c6696d35b566d3e8eacb25f7a6b255e4fc1bbcdc))
* **event-sourcing:** simplify event sourcing pipeline boilerplate ([#2748](https://github.com/langwatch/langwatch/issues/2748)) ([89ab755](https://github.com/langwatch/langwatch/commit/89ab75512b13d72f489e069c110ba44d3d05eec0))
* extract org router business logic into service/repository layers ([#2874](https://github.com/langwatch/langwatch/issues/2874)) ([ec874aa](https://github.com/langwatch/langwatch/commit/ec874aa51c9e5338c5e910e605f379cbc77f893b))
* **hooks:** decompose useModelProviderForm into focused sub-hooks ([#2532](https://github.com/langwatch/langwatch/issues/2532)) ([db154b9](https://github.com/langwatch/langwatch/commit/db154b92f4dbcc66a68ddaba26c11849fda00bc7))
* improve app-layer encapsulation and dependencies ([#2203](https://github.com/langwatch/langwatch/issues/2203)) ([4929aac](https://github.com/langwatch/langwatch/commit/4929aac9cba954159e3b19aefda789b32f44f17a))
* inline dependency injection from saas layer ([#2952](https://github.com/langwatch/langwatch/issues/2952)) ([3a1aa2b](https://github.com/langwatch/langwatch/commit/3a1aa2b8f1d1140bd7249c684fdbc332d5f72d37))
* migrate PromptTagAssignment.tag to tagId with Prisma relation ([#2912](https://github.com/langwatch/langwatch/issues/2912)) ([611ac0c](https://github.com/langwatch/langwatch/commit/611ac0c3d377705bcfbdb42232ed265c40c469ed))
* migrate satisfaction score to sentiment evaluator in langevals ([#2207](https://github.com/langwatch/langwatch/issues/2207)) ([7eef52a](https://github.com/langwatch/langwatch/commit/7eef52aa92bd9205e3e18c470487ca3174fe9d13))
* remove hardcoded gpt-5.2 default in buildDefaultVersionConfigData ([#2020](https://github.com/langwatch/langwatch/issues/2020)) ([d4ab644](https://github.com/langwatch/langwatch/commit/d4ab6445135efe2ef4ebd9b9fc83a2dc3bc2b191)), closes [#1913](https://github.com/langwatch/langwatch/issues/1913)
* rename langwatch.source to langwatch.origin.source ([#2078](https://github.com/langwatch/langwatch/issues/2078)) ([aeee2b9](https://github.com/langwatch/langwatch/commit/aeee2b9e87d2d3df80bdd98f9411b57bd8c29ba3))
* rename promptLabel to promptTag for naming consistency ([#2900](https://github.com/langwatch/langwatch/issues/2900)) ([70be268](https://github.com/langwatch/langwatch/commit/70be2689124e21e8f7d90c12aaa83887ed97f98c))
* replace heavy DEDUP inner subqueries with lightweight IN-tuple dedup ([#2789](https://github.com/langwatch/langwatch/issues/2789)) ([d2a5a94](https://github.com/langwatch/langwatch/commit/d2a5a94a12fb76bceb3ec3ff534ace087629332b))
* replace heavy DEDUP_*_COLUMNS inner subqueries with lightweight IN-tuple dedup ([d2a5a94](https://github.com/langwatch/langwatch/commit/d2a5a94a12fb76bceb3ec3ff534ace087629332b))
* **scenarios:** rename scenario-run.service to scenario-run.utils ([#2049](https://github.com/langwatch/langwatch/issues/2049)) ([3514e2f](https://github.com/langwatch/langwatch/commit/3514e2fdf582eebe3ae48034a2caef33f875397f))
* **scenarios:** rename scenario-run.service to scenario-run.utils ([#2149](https://github.com/langwatch/langwatch/issues/2149)) ([3514e2f](https://github.com/langwatch/langwatch/commit/3514e2fdf582eebe3ae48034a2caef33f875397f))
* **studio:** consolidate NewVersionFields duplication ([#2358](https://github.com/langwatch/langwatch/issues/2358)) ([8988480](https://github.com/langwatch/langwatch/commit/8988480c9b59e1399d15c3a1b63e792e26bea662))
* **studio:** migrate Publish/Optimize to use currentVersionId from store ([#2359](https://github.com/langwatch/langwatch/issues/2359)) ([5785118](https://github.com/langwatch/langwatch/commit/57851181f802f9b5600de8e46b554acec5cc1e0f))
* **studio:** move version state into workflow store for synchronous evaluate button ([#2279](https://github.com/langwatch/langwatch/issues/2279)) ([26ecc25](https://github.com/langwatch/langwatch/commit/26ecc25f22d4bba62743177c4a85ec1cbe987cd1))
* type-safe AbstractFoldProjection base class ([#2747](https://github.com/langwatch/langwatch/issues/2747)) ([a7735b1](https://github.com/langwatch/langwatch/commit/a7735b1a9d404697a2a811fd1127224faa854168))
* use named params and shared type for updateMetadata ([#2451](https://github.com/langwatch/langwatch/issues/2451)) ([c0f9c87](https://github.com/langwatch/langwatch/commit/c0f9c87be0293cfa6fb21e9c99dff4b58cbf0098))

## [2.6.0](https://github.com/langwatch/langwatch/compare/langwatch@v2.5.0...langwatch@v2.6.0) (2026-03-01)


### Features

* add new event sourcing observability tooling, called skynet ([#1865](https://github.com/langwatch/langwatch/issues/1865)) ([b759012](https://github.com/langwatch/langwatch/commit/b75901283d238dbf32df4f80e3eda4f95c561232))
* **billing:** add subscription override support for all plan limit fields ([3ac5ba7](https://github.com/langwatch/langwatch/commit/3ac5ba768a790761f32850a113ddfcac0970374d))
* **billing:** add subscription override support for all plan limit fields ([#1862](https://github.com/langwatch/langwatch/issues/1862)) ([3ac5ba7](https://github.com/langwatch/langwatch/commit/3ac5ba768a790761f32850a113ddfcac0970374d))
* encrypt model provider API keys at rest ([#1764](https://github.com/langwatch/langwatch/issues/1764)) ([7f194b2](https://github.com/langwatch/langwatch/commit/7f194b27579c0c26ffe351c778ab89d47d1cb545))
* evaluation fixes  ([#1839](https://github.com/langwatch/langwatch/issues/1839)) ([a31f460](https://github.com/langwatch/langwatch/commit/a31f460490b03bf66857ab21c88eaa135cb2ad06))
* **licensing:** add usageUnit to license schema and generation ([#1860](https://github.com/langwatch/langwatch/issues/1860)) ([2fc56ec](https://github.com/langwatch/langwatch/commit/2fc56ecad0512f92e87179f1b5a79cbc74d9e9b6))
* otel trace context propagation for HTTP scenario targets ([#1840](https://github.com/langwatch/langwatch/issues/1840)) ([5b0507d](https://github.com/langwatch/langwatch/commit/5b0507dddf88c1d600416e4c5866549a6f5dfcca))
* **subscription:** implement new billing model ([#1742](https://github.com/langwatch/langwatch/issues/1742)) ([bda81e8](https://github.com/langwatch/langwatch/commit/bda81e836568327a210d8cf5bcb6e2469c59e6bb))
* **suites:** add time filter for suite runs ([#1827](https://github.com/langwatch/langwatch/issues/1827)) ([8b8cc84](https://github.com/langwatch/langwatch/commit/8b8cc84cef6375a359efe35bacabe4232cc94fce))


### Bug Fixes

* actually use, not just enable, async inserts in clickhouse inserts ([#1876](https://github.com/langwatch/langwatch/issues/1876)) ([745a1a8](https://github.com/langwatch/langwatch/commit/745a1a83c71683c855acbbc5616bb5d3750c8b02))
* **billing:** make FREE plan limits pricing-model-aware for SEAT_EVENT orgs ([c7b2f74](https://github.com/langwatch/langwatch/commit/c7b2f74d81dc77e5c555e12580c522e26bb8f815))
* **billing:** make plan limits as pricing-model-aware for orgs ([#1850](https://github.com/langwatch/langwatch/issues/1850)) ([c7b2f74](https://github.com/langwatch/langwatch/commit/c7b2f74d81dc77e5c555e12580c522e26bb8f815))
* change default org pricing model from TIERED to SEAT_EVENT ([209c21f](https://github.com/langwatch/langwatch/commit/209c21fbaba0c5abdc6bcd3b879716e3358bdcf9))
* change default org pricing model to SEAT_EVENT ([#1832](https://github.com/langwatch/langwatch/issues/1832)) ([209c21f](https://github.com/langwatch/langwatch/commit/209c21fbaba0c5abdc6bcd3b879716e3358bdcf9))
* **contact:** update contact link from mail to HubSpot link ([#1835](https://github.com/langwatch/langwatch/issues/1835)) ([c919520](https://github.com/langwatch/langwatch/commit/c9195206f3d84bfa99f1a2dae0e3db2239083170))
* **contact:** update contact linkt from mail to hubspot link ([c919520](https://github.com/langwatch/langwatch/commit/c9195206f3d84bfa99f1a2dae0e3db2239083170))
* **event-sourcing:** increase global concurrency ([#1877](https://github.com/langwatch/langwatch/issues/1877)) ([5f76fb3](https://github.com/langwatch/langwatch/commit/5f76fb37c9d80d94ba877bcf8b26737b93b8ad67))
* **event-sourcing:** race condition in redis lua group queues handling ([#1873](https://github.com/langwatch/langwatch/issues/1873)) ([82a6e26](https://github.com/langwatch/langwatch/commit/82a6e26b3a160e82b4f784cc17c2d1088be787c6))
* missing started at in simulation projection ([#1874](https://github.com/langwatch/langwatch/issues/1874)) ([da8e7c0](https://github.com/langwatch/langwatch/commit/da8e7c0a56452b97251143de54a3682c3f9dc40c))
* **subscription:** correct legacy paid plan detection logic ([de73e28](https://github.com/langwatch/langwatch/commit/de73e28de1f856514a0b894a695b70d752d99d22))
* **subscription:** correct legacy paid plan detection logic ([#1842](https://github.com/langwatch/langwatch/issues/1842)) ([de73e28](https://github.com/langwatch/langwatch/commit/de73e28de1f856514a0b894a695b70d752d99d22))
* **suites:** use query param routing with slugs for direct suite access ([#1826](https://github.com/langwatch/langwatch/issues/1826)) ([2613a77](https://github.com/langwatch/langwatch/commit/2613a77b30b7e63b87ebc28d406bc5efa168bb5a))


### Miscellaneous

* add length limit to PII detection, matching the limit of the library itself ([#1864](https://github.com/langwatch/langwatch/issues/1864)) ([2f14579](https://github.com/langwatch/langwatch/commit/2f14579d13fe554d641a4e7d1e6269ca5e05669f))
* **billing:** update stripe catalog with new growth event prices ([#1829](https://github.com/langwatch/langwatch/issues/1829)) ([627285c](https://github.com/langwatch/langwatch/commit/627285ca877a78ab905938b5e0c0ea45c1278cc5))


### Code Refactoring

* **billing:** move usage reporting into event sourcing framework ([#1863](https://github.com/langwatch/langwatch/issues/1863)) ([9fe011a](https://github.com/langwatch/langwatch/commit/9fe011ab89a9c1563c8b714006795132f6481871))
* **event-sourcing:** global queue consolidation and ClickHouse experiment run fixes ([#1861](https://github.com/langwatch/langwatch/issues/1861)) ([00795de](https://github.com/langwatch/langwatch/commit/00795de770f27b6db64a05e349b8c9a7cb7c662e))
* **subscription:** extract SubscriptionService interface and EE implementation ([#1838](https://github.com/langwatch/langwatch/issues/1838)) ([d98c18e](https://github.com/langwatch/langwatch/commit/d98c18e075ebc3e707fafc4da664ec8e9d1ef4a9))
* **suites:** extract suite-run dependencies into proper repositories ([#1836](https://github.com/langwatch/langwatch/issues/1836)) ([bc64d1e](https://github.com/langwatch/langwatch/commit/bc64d1ea5078cd096fddec943e556972a08f307b))
* **usage:** update usage page to support license/subscription ([#1837](https://github.com/langwatch/langwatch/issues/1837)) ([f8e0de2](https://github.com/langwatch/langwatch/commit/f8e0de263c8b8f0a1a27ad2811f8000ad8499e33))

## [2.5.0](https://github.com/langwatch/langwatch/compare/langwatch@v2.4.2...langwatch@v2.5.0) (2026-02-25)


### Features

* add /watch-ci and /launch skills ([#1784](https://github.com/langwatch/langwatch/issues/1784)) ([ba1e76a](https://github.com/langwatch/langwatch/commit/ba1e76a37e1d7b5d999804925c90df5724f177c7))
* add group-by selector for suite run history ([#1743](https://github.com/langwatch/langwatch/issues/1743)) ([ba7fee5](https://github.com/langwatch/langwatch/commit/ba7fee5f1753708e8e144fe3eb8884bfef6896f9))
* add platform MCP tools for evaluators and model providers ([#1762](https://github.com/langwatch/langwatch/issues/1762)) ([6339001](https://github.com/langwatch/langwatch/commit/6339001ffae3c83f7c3ea0cdadf480f4ec47f3cc))
* **billing:** add billing foundation for seat+event pricing model ([#1800](https://github.com/langwatch/langwatch/issues/1800)) ([48f2e54](https://github.com/langwatch/langwatch/commit/48f2e54c8931fa641218f0769362b1068cc94f4f))
* **billing:** add usage reporting worker and billing meter dispatch ([#1733](https://github.com/langwatch/langwatch/issues/1733)) ([d8e5fa7](https://github.com/langwatch/langwatch/commit/d8e5fa7ea35c4cea490cf354eb3972025b8ef41e))
* collapsible suite sidebar ([#1817](https://github.com/langwatch/langwatch/issues/1817)) ([6a28431](https://github.com/langwatch/langwatch/commit/6a284315c504e9fe48c22664fb099c6230309a16))
* convert scenario BatchActionBar to floating bottom bar ([#1766](https://github.com/langwatch/langwatch/issues/1766)) ([5063299](https://github.com/langwatch/langwatch/commit/50632992a0ed10664ed20b77dad8370b720c394a))
* convert scenario BatchActionBar to floating bottom bar ([#1787](https://github.com/langwatch/langwatch/issues/1787)) ([5063299](https://github.com/langwatch/langwatch/commit/50632992a0ed10664ed20b77dad8370b720c394a))
* default to "All Runs" view when opening Suites page ([c2dd1dd](https://github.com/langwatch/langwatch/commit/c2dd1dd1cc57b2f9b6640594884bc5c2b454a72f)), closes [#1771](https://github.com/langwatch/langwatch/issues/1771)
* default to All Runs view when opening Suites page ([#1813](https://github.com/langwatch/langwatch/issues/1813)) ([c2dd1dd](https://github.com/langwatch/langwatch/commit/c2dd1dd1cc57b2f9b6640594884bc5c2b454a72f))
* defer scenario persistence until explicit Save ([#1783](https://github.com/langwatch/langwatch/issues/1783)) ([b21337d](https://github.com/langwatch/langwatch/commit/b21337da242cc05760d629e13113f013b86e6216)), closes [#1769](https://github.com/langwatch/langwatch/issues/1769)
* display scenario names in All Runs row headers ([#1816](https://github.com/langwatch/langwatch/issues/1816)) ([618dfda](https://github.com/langwatch/langwatch/commit/618dfda09dc093650033e38f3541332d2ff42842))
* remove label generation from AI scenario creation ([#1770](https://github.com/langwatch/langwatch/issues/1770)) ([112cee9](https://github.com/langwatch/langwatch/commit/112cee9833062520fc230825bafda9384b9d6bd1))
* remove label generation from AI scenario creation ([#1788](https://github.com/langwatch/langwatch/issues/1788)) ([112cee9](https://github.com/langwatch/langwatch/commit/112cee9833062520fc230825bafda9384b9d6bd1))
* rework event sourcing, move product to dual write, improve scenarios and platform performance ([#1704](https://github.com/langwatch/langwatch/issues/1704)) ([b0048b8](https://github.com/langwatch/langwatch/commit/b0048b8dfb39f0343a87966dbebf951d978fe52d))
* **skills:** check for existing feature files before creating new ones ([#1791](https://github.com/langwatch/langwatch/issues/1791)) ([e41a7ac](https://github.com/langwatch/langwatch/commit/e41a7acaf852beb713d9e5dc50c366c229d70834))
* skip hostname and TLS validation in scenario runner for on-prem ([#1818](https://github.com/langwatch/langwatch/issues/1818)) ([93b2a7a](https://github.com/langwatch/langwatch/commit/93b2a7aa34ea1002baebb12eb2f16bd61a24a21e))
* skip hostname/TLS validation in scenario runner for on-prem ([#1821](https://github.com/langwatch/langwatch/issues/1821)) ([93b2a7a](https://github.com/langwatch/langwatch/commit/93b2a7aa34ea1002baebb12eb2f16bd61a24a21e))
* standardize search fields with shared SearchInput component ([#1672](https://github.com/langwatch/langwatch/issues/1672)) ([72e82e2](https://github.com/langwatch/langwatch/commit/72e82e2657782f1f5fa2485a8e07369d52ab1ce5))
* standardize search fields with shared SearchInput component ([#1815](https://github.com/langwatch/langwatch/issues/1815)) ([72e82e2](https://github.com/langwatch/langwatch/commit/72e82e2657782f1f5fa2485a8e07369d52ab1ce5))
* suite sidebar shows pass count, recency, and three-dot menu ([#1776](https://github.com/langwatch/langwatch/issues/1776)) ([a3d3d96](https://github.com/langwatch/langwatch/commit/a3d3d9605f702353c1bafe388509ed9b25e99c83))
* **suites:** archive instead of hard delete ([#1808](https://github.com/langwatch/langwatch/issues/1808)) ([8314ad9](https://github.com/langwatch/langwatch/commit/8314ad9c1eb095ac49a4c0d740a232d651050669))


### Bug Fixes

* adding StatementEnd + ENVSUB OFF ([#1797](https://github.com/langwatch/langwatch/issues/1797)) ([2c324a6](https://github.com/langwatch/langwatch/commit/2c324a69d50b843a73a9bf2b35aa525a44d8e16c))
* bump clickhouse migration version from 00024 to 00025 ([#1796](https://github.com/langwatch/langwatch/issues/1796)) ([782cd07](https://github.com/langwatch/langwatch/commit/782cd0776df329ffc595b8d421b91feff2729109))
* change default pricing model from SEAT_EVENT to TIERED  ([5bc983b](https://github.com/langwatch/langwatch/commit/5bc983b5b3466d69521d1352465f93f4e1274bea))
* change default pricing model from SEAT_EVENT to TIERED ([#1798](https://github.com/langwatch/langwatch/issues/1798)) ([5bc983b](https://github.com/langwatch/langwatch/commit/5bc983b5b3466d69521d1352465f93f4e1274bea))
* close scenario drawer after save completes ([#1785](https://github.com/langwatch/langwatch/issues/1785)) ([3170e04](https://github.com/langwatch/langwatch/commit/3170e046901aef760b152f289b91efaf5d823099))
* close scenario drawer after save completes ([#1810](https://github.com/langwatch/langwatch/issues/1810)) ([3170e04](https://github.com/langwatch/langwatch/commit/3170e046901aef760b152f289b91efaf5d823099))
* event-sourcing review comments ([#1795](https://github.com/langwatch/langwatch/issues/1795)) ([a78e8b4](https://github.com/langwatch/langwatch/commit/a78e8b40df4d9dce08f5505e362b59b47d48353b))
* increase HTTP agent default timeout to 5 minutes ([#1786](https://github.com/langwatch/langwatch/issues/1786)) ([06f93d1](https://github.com/langwatch/langwatch/commit/06f93d1eba6e913a1a44affc762e938437e160a9))
* normalize defaultModel with provider prefix for litellm routing ([cc7798e](https://github.com/langwatch/langwatch/commit/cc7798ecb229654f371912e7863ca20364ceb7fa))
* recreate billable_events with ReplacingMergeTree engine ([#1794](https://github.com/langwatch/langwatch/issues/1794)) ([3637ca8](https://github.com/langwatch/langwatch/commit/3637ca804fe01ecbf000bece639eba15ac78126d))
* remove padding for scenario library page ([#1758](https://github.com/langwatch/langwatch/issues/1758)) ([5226da4](https://github.com/langwatch/langwatch/commit/5226da4b02e71d7c76999104ae2c72bc5da6a230))
* remove unnecessary RAG mention in timeout comment ([#1789](https://github.com/langwatch/langwatch/issues/1789)) ([6a60d33](https://github.com/langwatch/langwatch/commit/6a60d335c26fb3d372c9a40b5fbd4a62dc2baece))
* use KSUID with provider_ prefix for model provider IDs and fix empty state icon ([0b2669f](https://github.com/langwatch/langwatch/commit/0b2669ffd0fbeb2468714e12fb4cdddae1aa22ad))


### Miscellaneous

* event sourcing improvements + evaluation fixes ([#1805](https://github.com/langwatch/langwatch/issues/1805)) ([9964a08](https://github.com/langwatch/langwatch/commit/9964a082eb27a4d74d4d50cd5bcb8e1a215ce21c))
* fix clickhouse analytics query + prepare bullboard for containerisation ([#1820](https://github.com/langwatch/langwatch/issues/1820)) ([f2bbd1c](https://github.com/langwatch/langwatch/commit/f2bbd1cc0542726133dc3ea28fe3dc87df9025fb))
* more event sourcing improvements + gaps ([#1793](https://github.com/langwatch/langwatch/issues/1793)) ([7e43524](https://github.com/langwatch/langwatch/commit/7e43524c3f39f050beaceb16bda5115879254da8))
* sample fix and reduce FINAL usage for clickhouse ([#1799](https://github.com/langwatch/langwatch/issues/1799)) ([9982949](https://github.com/langwatch/langwatch/commit/9982949cedf7c20282a589fb638a082265dc3c56))
* sync model registry ([b47eee8](https://github.com/langwatch/langwatch/commit/b47eee886ba7501df734a7f2360ee73a321f871a))
* sync model registry (329 models) ([#1765](https://github.com/langwatch/langwatch/issues/1765)) ([b47eee8](https://github.com/langwatch/langwatch/commit/b47eee886ba7501df734a7f2360ee73a321f871a))


### Code Refactoring

* **billing:** replace dispatch map projection with reactor ([#1801](https://github.com/langwatch/langwatch/issues/1801)) ([35017cb](https://github.com/langwatch/langwatch/commit/35017cb763a3fb0f4543651fb42d595b5c8f4e83))
* move scenario run status config from server/ to components/ ([#1809](https://github.com/langwatch/langwatch/issues/1809)) ([4020fed](https://github.com/langwatch/langwatch/commit/4020feda1443a26e90deb9e1dee2ba51a4e9dfa2))
* replace useState form management with react-hook-form + Zod in suite form ([#1775](https://github.com/langwatch/langwatch/issues/1775)) ([683f162](https://github.com/langwatch/langwatch/commit/683f162c8588bd15d6455c9dcd369eec03ffc110))

## [2.4.2](https://github.com/langwatch/langwatch/compare/langwatch@v2.4.1...langwatch@v2.4.2) (2026-02-20)


### Bug Fixes

* clean up release_ui_simulations_menu_enabled feature flag ([6ae6175](https://github.com/langwatch/langwatch/commit/6ae6175aabd99f9c962fc36bbe3dbdbecf852be3))

## [2.4.1](https://github.com/langwatch/langwatch/compare/langwatch@v2.4.0...langwatch@v2.4.1) (2026-02-20)


### Bug Fixes

* copy SDK package files for generate-sdk-versions.sh in Docker build ([455c0ca](https://github.com/langwatch/langwatch/commit/455c0caa0e982c29f3cf30cec6b2c3b5ae58eda7))
* copy SDK package files into Docker image for build ([#1753](https://github.com/langwatch/langwatch/issues/1753)) ([455c0ca](https://github.com/langwatch/langwatch/commit/455c0caa0e982c29f3cf30cec6b2c3b5ae58eda7))

## [2.4.0](https://github.com/langwatch/langwatch/compare/langwatch@v2.3.0...langwatch@v2.4.0) (2026-02-20)


### Features

* add extensible metadata support to scenario run events ([#1734](https://github.com/langwatch/langwatch/issues/1734)) ([e4cd154](https://github.com/langwatch/langwatch/commit/e4cd154682205e1af4a8801ffa073c0444e50ca4))
* add project secrets manager ([#1709](https://github.com/langwatch/langwatch/issues/1709)) ([54db16e](https://github.com/langwatch/langwatch/commit/54db16ef4e368c5f351a1671d07cbe26566e6b9a))
* add scenario management tools to MCP server ([#1705](https://github.com/langwatch/langwatch/issues/1705)) ([0376fde](https://github.com/langwatch/langwatch/commit/0376fde0abff7b110b4ec5996a399c4b2ceafde0))


### Bug Fixes

* include langevals generated types in Docker build ([#1741](https://github.com/langwatch/langwatch/issues/1741)) ([534a25d](https://github.com/langwatch/langwatch/commit/534a25dae1e4ad24604d800ccb9f52f0bc7394c6))
* replace sdk-versions.json with build-time generation ([#1746](https://github.com/langwatch/langwatch/issues/1746)) ([20293d3](https://github.com/langwatch/langwatch/commit/20293d3407fea49524dd853efbfba94d1fe3d0a8))
* worktree script warns when .env files are missing ([#1747](https://github.com/langwatch/langwatch/issues/1747)) ([b30feef](https://github.com/langwatch/langwatch/commit/b30feef56a1013fb3ee1f6b6a3199a11bbb26353))

## [2.3.0](https://github.com/langwatch/langwatch/compare/langwatch@v2.2.0...langwatch@v2.3.0) (2026-02-17)


### Features

* add AI-readable trace mapping to dataset mapping dropdowns ([#1437](https://github.com/langwatch/langwatch/issues/1437)) ([82d9c3d](https://github.com/langwatch/langwatch/commit/82d9c3d4605970eb994aa3ee0765140101fa5a2b))
* add experiment eval runs (eval v3) to event sourcing ([#1276](https://github.com/langwatch/langwatch/issues/1276)) ([791415a](https://github.com/langwatch/langwatch/commit/791415aeb90a14109c5841fb4583d6eddc558b92))
* add library to help catch trace parity dift betwen ElasicSearch and ClickHouse ([#1426](https://github.com/langwatch/langwatch/issues/1426)) ([bce70bf](https://github.com/langwatch/langwatch/commit/bce70bfe453a9202414e17afa8018786fe3d225f))
* add POST /api/evaluators to create evaluators via REST API ([#1574](https://github.com/langwatch/langwatch/issues/1574)) ([3084655](https://github.com/langwatch/langwatch/commit/308465566db22345663ba78135338ad587e8d84d))
* add public REST API for evaluators ([#1540](https://github.com/langwatch/langwatch/issues/1540)) ([46f4064](https://github.com/langwatch/langwatch/commit/46f4064c32dee33be58eee54f98c810a0da57cee))
* add public REST API for evaluators (/api/evaluators) ([46f4064](https://github.com/langwatch/langwatch/commit/46f4064c32dee33be58eee54f98c810a0da57cee))
* add separate worker pod deployment to Helm chart ([#1436](https://github.com/langwatch/langwatch/issues/1436)) ([49657a1](https://github.com/langwatch/langwatch/commit/49657a1807667ef4585eab7cde78e626aff923ae))
* added sdk version usage tracking + sdk radar to notify users of outdated sdks ([#1653](https://github.com/langwatch/langwatch/issues/1653)) ([e423b54](https://github.com/langwatch/langwatch/commit/e423b54de5f3a172856406a5be5b133ae9eb10b3))
* bullboard view for event sourcing groups ([#1632](https://github.com/langwatch/langwatch/issues/1632)) ([0a191ba](https://github.com/langwatch/langwatch/commit/0a191ba43eb85cf3c5071736778878312ba5de28))
* **cli:** add separate prompt pull and prompt push commands ([#1543](https://github.com/langwatch/langwatch/issues/1543)) ([76c4881](https://github.com/langwatch/langwatch/commit/76c48817d284b300b33a37bbc52c4047bff8e36e))
* dedicated endpoint for span names and metadata keys ([#1434](https://github.com/langwatch/langwatch/issues/1434)) ([1ea0297](https://github.com/langwatch/langwatch/commit/1ea02975dabbe7ad648edcd30f0c695bc0a023b2))
* full Liquid template support with autocomplete ([#1583](https://github.com/langwatch/langwatch/issues/1583)) ([00863a7](https://github.com/langwatch/langwatch/commit/00863a7643c8f6af48582bf82512fd37391902a7))
* **license:** add contact sales link to license activation page ([#1552](https://github.com/langwatch/langwatch/issues/1552)) ([2168404](https://github.com/langwatch/langwatch/commit/2168404d6734f2f4e63b69f2c9e9f8c3be6eda10))
* **license:** add purchase license link to license activation page ([#1572](https://github.com/langwatch/langwatch/issues/1572)) ([fc0acdb](https://github.com/langwatch/langwatch/commit/fc0acdb231ce4301b32d84ba1f4efbb4a96da28d))
* **members:** add pending invitation logic ([#1412](https://github.com/langwatch/langwatch/issues/1412)) ([d54416f](https://github.com/langwatch/langwatch/commit/d54416f62ebda1306545fc45a2b6774c9224d6e8))
* move langevals into monorepo ([#1591](https://github.com/langwatch/langwatch/issues/1591)) ([0d8a7ed](https://github.com/langwatch/langwatch/commit/0d8a7ed1278f7218e9a1749b247566853b1a3268))
* move table TTL orchestration to application layer ([#1414](https://github.com/langwatch/langwatch/issues/1414)) ([61fd8a4](https://github.com/langwatch/langwatch/commit/61fd8a4e60bf049a0b1e20a5d7228070950a0959))
* **scenarios:** enable code agents as scenario targets ([#1545](https://github.com/langwatch/langwatch/issues/1545)) ([7d8573e](https://github.com/langwatch/langwatch/commit/7d8573e4393fe3382382de28adb141435dc8cf02))
* studio evaluator sidebar, inline editing, agent/HTTP nodes, llm-as-a-judge image support and image rendering on experiments workbench ([#1589](https://github.com/langwatch/langwatch/issues/1589)) ([3da4f98](https://github.com/langwatch/langwatch/commit/3da4f982d532cac9fbb576f2b56a2ded5f726a55))
* suite workflow — create, run, see results ([#1421](https://github.com/langwatch/langwatch/issues/1421)) ([7291b60](https://github.com/langwatch/langwatch/commit/7291b60e361b917d9a65c6939f67135e8c85d206))


### Bug Fixes

* add tslib as package extension to fix otel bullmq ([#1631](https://github.com/langwatch/langwatch/issues/1631)) ([ae584aa](https://github.com/langwatch/langwatch/commit/ae584aa8c2b9c1f51a5ef2a20abe8e3173f1aa26))
* base64 image rendering and evaluator body size limit ([#1638](https://github.com/langwatch/langwatch/issues/1638)) ([d6e1b80](https://github.com/langwatch/langwatch/commit/d6e1b802476d1aa4b4aa301544daead4f0bad263))
* bundle analysis conditional import ([#1596](https://github.com/langwatch/langwatch/issues/1596)) ([62dcb84](https://github.com/langwatch/langwatch/commit/62dcb845836c916389fb87c28367accb22058ae0))
* CI stability — NLP duration assertion and app-ci OOM ([c475af5](https://github.com/langwatch/langwatch/commit/c475af5453d6adf0e3a605f664d0f064e77e2587))
* ci stability — NLP duration assertion and app-ci OOM ([#1599](https://github.com/langwatch/langwatch/issues/1599)) ([c475af5](https://github.com/langwatch/langwatch/commit/c475af5453d6adf0e3a605f664d0f064e77e2587))
* CLI sync now properly sends structured outputs to backend ([#1645](https://github.com/langwatch/langwatch/issues/1645)) ([9b57d7a](https://github.com/langwatch/langwatch/commit/9b57d7a9ffbc2d525261d3b509f12a1c01ccdda0))
* code agent editor broken inputs form ([#1646](https://github.com/langwatch/langwatch/issues/1646)) ([c8bdc25](https://github.com/langwatch/langwatch/commit/c8bdc2599a6713c701fdc6acb38d72dca2aab096))
* **event-sourcing:** add redis caching for checkpoint methods ([#1539](https://github.com/langwatch/langwatch/issues/1539)) ([f0c5cba](https://github.com/langwatch/langwatch/commit/f0c5cbaabc1261aabe9be309106e0fc147e27906))
* guard against undefined llmConfig in nodeDataToLocalPromptConfig ([a4a8b5d](https://github.com/langwatch/langwatch/commit/a4a8b5daec1498ce1eef71afd982450d66495995))
* handle NaN/Infinity in JSON serialization for batch evaluation payloads ([#1557](https://github.com/langwatch/langwatch/issues/1557)) ([072c347](https://github.com/langwatch/langwatch/commit/072c347ca3ba7c148ae19d0d9e3fc80f6d6c84fc))
* handle NaN/Infinity in JSON serialization for batch evaluation payloads ([#1558](https://github.com/langwatch/langwatch/issues/1558)) ([072c347](https://github.com/langwatch/langwatch/commit/072c347ca3ba7c148ae19d0d9e3fc80f6d6c84fc))
* include target and index in BullMQ scenario job ID to prevent deduplication ([da1aa47](https://github.com/langwatch/langwatch/commit/da1aa4753f65b7d2aa6c008a853641de51c918ee)), closes [#1396](https://github.com/langwatch/langwatch/issues/1396)
* increase body size limit to 30mb for datasetRecord.update ([d378066](https://github.com/langwatch/langwatch/commit/d378066ffbeb6dc8329b9bc245ee25c5d79808d7))
* missing model overriding the whole prompt by accident ([422f660](https://github.com/langwatch/langwatch/commit/422f660ff22b353b1249295ec2909edab60f0a9d))
* mock @copilotkit/react-ui to prevent @react-aria/interactions crash in vmThreads ([2426aa7](https://github.com/langwatch/langwatch/commit/2426aa74e41809a47a7cae4c051cc0f8b331d753))
* prevent cascading dataset sync requests on cell edit ([c230d03](https://github.com/langwatch/langwatch/commit/c230d0304b2aaa0f5a917791c92de2f54688a273))
* prompt editor losing content due to watch firing before init ([4ae7c73](https://github.com/langwatch/langwatch/commit/4ae7c730f5e45bd51a003c87b9fa9e70e9bcb155))
* **settings:** enforce Lite Member role sync and explicit member save flow ([#1413](https://github.com/langwatch/langwatch/issues/1413)) ([1fdbaa3](https://github.com/langwatch/langwatch/commit/1fdbaa36e40fd769dc628e69a6b71bbbc10f13bf))
* studio prompt editor bugs — structured outputs toggle, variable types, and test fixes ([0df27cb](https://github.com/langwatch/langwatch/commit/0df27cba5ec7d3be713a17d8daf434f28eb71322))
* studio prompt editor bugs ([#1590](https://github.com/langwatch/langwatch/issues/1590)) ([0df27cb](https://github.com/langwatch/langwatch/commit/0df27cba5ec7d3be713a17d8daf434f28eb71322))
* tRPC loggerMiddleware silently swallows all errors ([#1579](https://github.com/langwatch/langwatch/issues/1579)) ([426cb8e](https://github.com/langwatch/langwatch/commit/426cb8ed1bbd235e6f1b637a4bea1f7a034e077b))
* typescript sdk labels not configured correctly ([#1550](https://github.com/langwatch/langwatch/issues/1550)) ([13b07a4](https://github.com/langwatch/langwatch/commit/13b07a4b4d3abb281bdbfb49aadc367808a16391))
* update Azure API version to 2024-06-01 for tool_choice support ([#1547](https://github.com/langwatch/langwatch/issues/1547)) ([3f4ea00](https://github.com/langwatch/langwatch/commit/3f4ea0085b6334f5168581e6402cae92c6b2d83e)), closes [#1546](https://github.com/langwatch/langwatch/issues/1546)
* update BullMQ job ID deduplication for multi-target and repeated runs ([#1404](https://github.com/langwatch/langwatch/issues/1404)) ([da1aa47](https://github.com/langwatch/langwatch/commit/da1aa4753f65b7d2aa6c008a853641de51c918ee))
* use z.date() for evaluator schema dates to match Prisma output ([3b5041a](https://github.com/langwatch/langwatch/commit/3b5041a93c3b18f2c3c3cdb6713abdd567bad3e2))
* vitest vmThreads OOM — add vmMemoryLimit to recycle leaky workers ([52de8b6](https://github.com/langwatch/langwatch/commit/52de8b6260fb617b508521734a5e12db9af127b4))


### Miscellaneous

* **deps-dev:** bump chainlit from 2.8.3 to 2.9.6 in /python-sdk ([#1508](https://github.com/langwatch/langwatch/issues/1508)) ([5cdb91a](https://github.com/langwatch/langwatch/commit/5cdb91a628442b747eb776978156c5531ab80f61))
* **deps-dev:** bump fishery from 2.2.3 to 2.4.0 in /langwatch ([#1470](https://github.com/langwatch/langwatch/issues/1470)) ([1a89366](https://github.com/langwatch/langwatch/commit/1a893668b02d39a698da9285ab54fff424fd8b21))
* **deps-dev:** bump json-repair from 0.49.0 to 0.57.1 in /python-sdk ([#1507](https://github.com/langwatch/langwatch/issues/1507)) ([eb681e5](https://github.com/langwatch/langwatch/commit/eb681e5d5d341aee61fc9eed7236d9d40168c6ff))
* **deps-dev:** bump openinference-instrumentation-dspy from 0.1.28 to 0.1.33 in /python-sdk ([#1505](https://github.com/langwatch/langwatch/issues/1505)) ([1280b4c](https://github.com/langwatch/langwatch/commit/1280b4cab9e67ce2976837a6244588d8cfdfd814))
* **deps-dev:** bump openinference-instrumentation-dspy in /python-sdk ([1280b4c](https://github.com/langwatch/langwatch/commit/1280b4cab9e67ce2976837a6244588d8cfdfd814))
* **deps-dev:** bump python-dotenv from 1.0.1 to 1.2.1 in /python-sdk ([#1509](https://github.com/langwatch/langwatch/issues/1509)) ([01d4a17](https://github.com/langwatch/langwatch/commit/01d4a171ae4b6253d82e157d477ecac58d3de25f))
* **deps-dev:** update uvicorn requirement from &lt;0.40.0,&gt;=0.38.0 to &gt;=0.38.0,&lt;0.41.0 in /python-sdk ([#1445](https://github.com/langwatch/langwatch/issues/1445)) ([a26937d](https://github.com/langwatch/langwatch/commit/a26937df10f8dd39f93c79532d42a681fffb73d9))
* **deps-dev:** update uvicorn requirement in /python-sdk ([a26937d](https://github.com/langwatch/langwatch/commit/a26937df10f8dd39f93c79532d42a681fffb73d9))
* **deps:** bump @aws-sdk/client-cloudwatch-logs from 3.828.0 to 3.987.0 in /langwatch ([#1486](https://github.com/langwatch/langwatch/issues/1486)) ([caccdd5](https://github.com/langwatch/langwatch/commit/caccdd5103fd5ea41b2cd987d2cc0cd604e68f96))
* **deps:** bump @aws-sdk/client-cloudwatch-logs in /langwatch ([caccdd5](https://github.com/langwatch/langwatch/commit/caccdd5103fd5ea41b2cd987d2cc0cd604e68f96))
* **deps:** bump @aws-sdk/client-lambda from 3.817.0 to 3.987.0 in /langwatch ([#1476](https://github.com/langwatch/langwatch/issues/1476)) ([b7e24cb](https://github.com/langwatch/langwatch/commit/b7e24cb413cb2bdb6a2bc0375af09bcc362ec849))
* **deps:** bump @aws-sdk/client-lambda in /langwatch ([b7e24cb](https://github.com/langwatch/langwatch/commit/b7e24cb413cb2bdb6a2bc0375af09bcc362ec849))
* **deps:** bump @microlink/react-json-view from 1.23.1 to 1.27.1 in /langwatch ([#1480](https://github.com/langwatch/langwatch/issues/1480)) ([9f97192](https://github.com/langwatch/langwatch/commit/9f97192500f7de451f408da0b886b0c624f6ba5d))
* **deps:** bump @microlink/react-json-view in /langwatch ([9f97192](https://github.com/langwatch/langwatch/commit/9f97192500f7de451f408da0b886b0c624f6ba5d))
* **deps:** bump @next/bundle-analyzer from 15.3.3 to 16.1.6 in /langwatch ([#1485](https://github.com/langwatch/langwatch/issues/1485)) ([604a0fb](https://github.com/langwatch/langwatch/commit/604a0fb16493668e8aa05dcfed5ecfb634910c41))
* **deps:** bump @next/bundle-analyzer in /langwatch ([604a0fb](https://github.com/langwatch/langwatch/commit/604a0fb16493668e8aa05dcfed5ecfb634910c41))
* **deps:** bump @opentelemetry/context-async-hooks from 2.2.0 to 2.5.0 in /langwatch ([#1490](https://github.com/langwatch/langwatch/issues/1490)) ([f9fcf02](https://github.com/langwatch/langwatch/commit/f9fcf029e4919bdb9aa2676b1e19ea52a40b3e47))
* **deps:** bump @opentelemetry/context-async-hooks in /langwatch ([f9fcf02](https://github.com/langwatch/langwatch/commit/f9fcf029e4919bdb9aa2676b1e19ea52a40b3e47))
* **deps:** bump bcrypt and @types/bcrypt in /langwatch ([#1482](https://github.com/langwatch/langwatch/issues/1482)) ([930eca8](https://github.com/langwatch/langwatch/commit/930eca810a1a38fcb7fc71b7c820ae6c7a25c900))
* **deps:** bump esbuild from 0.23.1 to 0.27.3 in /langwatch ([#1484](https://github.com/langwatch/langwatch/issues/1484)) ([99ac643](https://github.com/langwatch/langwatch/commit/99ac643718a46d4a5c03a7b32d81b77e92ea9c91))
* **deps:** bump libphonenumber-js from 1.12.24 to 1.12.36 in /langwatch ([#1477](https://github.com/langwatch/langwatch/issues/1477)) ([68d1064](https://github.com/langwatch/langwatch/commit/68d10645453075ded9b166e2592afa12a06cf853))
* **deps:** bump libphonenumber-js in /langwatch ([68d1064](https://github.com/langwatch/langwatch/commit/68d10645453075ded9b166e2592afa12a06cf853))
* **deps:** bump mangum from 0.17.0 to 0.21.0 in /langwatch_nlp ([#1498](https://github.com/langwatch/langwatch/issues/1498)) ([2cf411a](https://github.com/langwatch/langwatch/commit/2cf411a9a66a2474c567396f2b3eb5407cfaac18))
* **deps:** bump mermaid from 11.12.0 to 11.12.2 in /langwatch ([#1491](https://github.com/langwatch/langwatch/issues/1491)) ([eaca044](https://github.com/langwatch/langwatch/commit/eaca044cf670d67713ce7e3339f9a0bf9cfc2a0b))
* **deps:** bump numpy from 1.26.4 to 2.4.2 in /langwatch_nlp ([#1500](https://github.com/langwatch/langwatch/issues/1500)) ([ba09059](https://github.com/langwatch/langwatch/commit/ba0905906aab267ca4d1ccb16ea37b5de750a334))
* **deps:** bump openai from 2.8.1 to 2.20.0 in /langwatch_nlp ([#1499](https://github.com/langwatch/langwatch/issues/1499)) ([1419d5c](https://github.com/langwatch/langwatch/commit/1419d5cd5c3c79c819ec380d2b4b820e82b89558))
* **deps:** bump pillow from 11.3.0 to 12.1.1 in /langwatch_nlp ([#1501](https://github.com/langwatch/langwatch/issues/1501)) ([69f7ec3](https://github.com/langwatch/langwatch/commit/69f7ec31dc32fa68dda8286c6563f72897f13541))
* **deps:** bump qs ([2d064b9](https://github.com/langwatch/langwatch/commit/2d064b93f48fc3002df5c199fff932f1e18aa441))
* **deps:** bump qs from 6.14.1 to 6.14.2 in /langwatch in the npm_and_yarn group across 1 directory ([#1569](https://github.com/langwatch/langwatch/issues/1569)) ([2d064b9](https://github.com/langwatch/langwatch/commit/2d064b93f48fc3002df5c199fff932f1e18aa441))
* **deps:** bump ruff from 0.12.9 to 0.15.0 in /python-sdk ([#1506](https://github.com/langwatch/langwatch/issues/1506)) ([89b6fb3](https://github.com/langwatch/langwatch/commit/89b6fb32a1571b87e3c7f963fa6e565b3063b8f1))
* **deps:** bump sass from 1.79.0 to 1.97.3 in /langwatch ([#1488](https://github.com/langwatch/langwatch/issues/1488)) ([f0527ac](https://github.com/langwatch/langwatch/commit/f0527ac4086f177548bc965a86b8a23cf90f0617))
* **deps:** bump shiki from 3.13.0 to 3.22.0 in /langwatch ([#1481](https://github.com/langwatch/langwatch/issues/1481)) ([296ad11](https://github.com/langwatch/langwatch/commit/296ad11143f318d1d5a44f044072f652ec794648))
* **deps:** bump the npm_and_yarn group across 1 directory with 3 updates ([#1532](https://github.com/langwatch/langwatch/issues/1532)) ([552d2bd](https://github.com/langwatch/langwatch/commit/552d2bd27c319a3fcf0b6339e7400a528098a0bb))
* **deps:** bump the npm_and_yarn group across 1 directory with 5 updates ([#1524](https://github.com/langwatch/langwatch/issues/1524)) ([95e8852](https://github.com/langwatch/langwatch/commit/95e88529f5afae5ad197849683eb5a78f41691eb))
* **deps:** bump ws and @types/ws in /langwatch ([#1492](https://github.com/langwatch/langwatch/issues/1492)) ([951f89a](https://github.com/langwatch/langwatch/commit/951f89ae49859e2210dad9c3e7f362e9bdbb40ab))
* **deps:** cleanup dependencies/dev dependencies ([#1594](https://github.com/langwatch/langwatch/issues/1594)) ([10a30e2](https://github.com/langwatch/langwatch/commit/10a30e254b5be4a7512df71396b26cab322e03d3))
* **deps:** update langwatch requirement from &lt;0.2,&gt;=0.1.37 to &gt;=0.1.37,&lt;0.11 in /langwatch_nlp ([#1444](https://github.com/langwatch/langwatch/issues/1444)) ([3715853](https://github.com/langwatch/langwatch/commit/3715853859285d936d0db89b9ec40a2c753fef76))
* **deps:** update langwatch requirement in /langwatch_nlp ([3715853](https://github.com/langwatch/langwatch/commit/3715853859285d936d0db89b9ec40a2c753fef76))
* fix test pyramid violations and naming conventions ([beb0203](https://github.com/langwatch/langwatch/commit/beb0203b4b9cb5d5c1bce40cb3f6a89d9db06fc9)), closes [#1649](https://github.com/langwatch/langwatch/issues/1649)
* fix test pyramid violations and naming in scenario tests ([#1650](https://github.com/langwatch/langwatch/issues/1650)) ([beb0203](https://github.com/langwatch/langwatch/commit/beb0203b4b9cb5d5c1bce40cb3f6a89d9db06fc9))
* **main:** release python-sdk 0.11.0 ([#1366](https://github.com/langwatch/langwatch/issues/1366)) ([8a93d1f](https://github.com/langwatch/langwatch/commit/8a93d1f6e23249bd1a695d3bd9c623316a3d785b))
* **main:** release python-sdk 0.12.0 ([#1544](https://github.com/langwatch/langwatch/issues/1544)) ([c866bcd](https://github.com/langwatch/langwatch/commit/c866bcdfbb1dcee5d113507c263c534f1b962732))
* **main:** release python-sdk 0.13.0 ([#1584](https://github.com/langwatch/langwatch/issues/1584)) ([aa72a8c](https://github.com/langwatch/langwatch/commit/aa72a8c6e8d97066914a1fe8ae0bc0ce14dc0111))
* **nlp:** improve log context propagation, improve log levels, fix log cascade, and improve error handling ([#1439](https://github.com/langwatch/langwatch/issues/1439)) ([94fb2ac](https://github.com/langwatch/langwatch/commit/94fb2ace70e18547728e75491a59d1f82272d3eb))


### Documentation

* add /challenge step to orchestration flow ([#1573](https://github.com/langwatch/langwatch/issues/1573)) ([701539b](https://github.com/langwatch/langwatch/commit/701539be9ade98674339fe6e7eeed84fa12a454b))
* consolidate langwatch/docs/ into root docs/ ([#1535](https://github.com/langwatch/langwatch/issues/1535)) ([58ef711](https://github.com/langwatch/langwatch/commit/58ef71139a1744d38d2213502be5049eb736588e)), closes [#1533](https://github.com/langwatch/langwatch/issues/1533)


### Code Refactoring

* **event-sourcing:** huge refactors with launch learnings ([#1593](https://github.com/langwatch/langwatch/issues/1593)) ([c2b808b](https://github.com/langwatch/langwatch/commit/c2b808bbfe1c982e3a36f1e17a9ccc9a3a85ec93))
* **event-sourcing:** replace suboptimal delaying/locking system with proper atomic queue grouping mechanism ([#1567](https://github.com/langwatch/langwatch/issues/1567)) ([693adf7](https://github.com/langwatch/langwatch/commit/693adf75ec43fd5658810bec62732534cf648aa3))
* **event-souring:** improve timestamp handling and consistency across the system ([#1633](https://github.com/langwatch/langwatch/issues/1633)) ([3d7043d](https://github.com/langwatch/langwatch/commit/3d7043d8f55fcdf57034d2c650d5c5978e3ae99c))

## [2.2.0](https://github.com/langwatch/langwatch/compare/langwatch@v2.1.0...langwatch@v2.2.0) (2026-02-10)


### Features

* increase OTEL collector body size limit from 1MB to 10MB ([3774f89](https://github.com/langwatch/langwatch/commit/3774f89a7b79f26407f079d82ee4016009ac4da0))
* increase OTEL collector body size limit to 10MB ([#1432](https://github.com/langwatch/langwatch/issues/1432)) ([3774f89](https://github.com/langwatch/langwatch/commit/3774f89a7b79f26407f079d82ee4016009ac4da0))
* map gen_ai.conversation.id to thread_id in OTEL traces ([#1428](https://github.com/langwatch/langwatch/issues/1428)) ([3b58d8e](https://github.com/langwatch/langwatch/commit/3b58d8ee8e02122c7ba63815713e6973a52537cd))


### Bug Fixes

* add auth pages to publicRoutes to prevent infinite redirect loop ([#1433](https://github.com/langwatch/langwatch/issues/1433)) ([3357334](https://github.com/langwatch/langwatch/commit/335733456e05e8513c7aace00ad47533f8a5c2d8))
* remove character limits on AI scenario generation ([#1430](https://github.com/langwatch/langwatch/issues/1430)) ([39d9ce1](https://github.com/langwatch/langwatch/commit/39d9ce1c6eb69a2205a27094cde4f14d23ba826e))
* theme toggle cut-off in collapsed sidebar ([#1382](https://github.com/langwatch/langwatch/issues/1382)) ([eeca00e](https://github.com/langwatch/langwatch/commit/eeca00ed70ad1941a0393f2604855bfafdab178f))


### Miscellaneous

* remove orphaned migration test file ([#1431](https://github.com/langwatch/langwatch/issues/1431)) ([a2358dc](https://github.com/langwatch/langwatch/commit/a2358dc847e85c8c41b025b4fa77ce6a30ae105a))
* sync model registry ([f937adb](https://github.com/langwatch/langwatch/commit/f937adb8a89c2581c9e6cbf1308a58c1c949a93b))
* sync model registry (332 models) ([#1417](https://github.com/langwatch/langwatch/issues/1417)) ([f937adb](https://github.com/langwatch/langwatch/commit/f937adb8a89c2581c9e6cbf1308a58c1c949a93b))

## [2.1.0](https://github.com/langwatch/langwatch/compare/langwatch@v2.0.2...langwatch@v2.1.0) (2026-02-09)


### Features

* add ability to archive scenarios from UI ([#1376](https://github.com/langwatch/langwatch/issues/1376)) ([09f9566](https://github.com/langwatch/langwatch/commit/09f956629037ce203f3d7f7046822f5e29a405fb))
* add ability to drill down on eval graphs ([#1172](https://github.com/langwatch/langwatch/issues/1172)) ([10ca94f](https://github.com/langwatch/langwatch/commit/10ca94f68f00a3bfbcb37e3c1ef1b9a400101a8e))
* add agent and evaluation replication ([#1287](https://github.com/langwatch/langwatch/issues/1287)) ([034ef6c](https://github.com/langwatch/langwatch/commit/034ef6c5c7844acc480f62b10f4ebe9502b00a23))
* add ClickHouse analytics backend with dual-database routing ([#1203](https://github.com/langwatch/langwatch/issues/1203)) ([0c49494](https://github.com/langwatch/langwatch/commit/0c49494e1e1e36ef47d2d7ed6dea7a116fa17bfa))
* add CUPID reviewer alongside Uncle Bob for parallel code reviews ([#1236](https://github.com/langwatch/langwatch/issues/1236)) ([a9ff151](https://github.com/langwatch/langwatch/commit/a9ff15152a5217da7c020e32ac518333feb1f7f4)), closes [#1235](https://github.com/langwatch/langwatch/issues/1235)
* add devils-advocate agent and /challenge skill ([#1369](https://github.com/langwatch/langwatch/issues/1369)) ([3de5efb](https://github.com/langwatch/langwatch/commit/3de5efb41075a369b91af0596eb1ce68ee1a772f))
* add local/dev indicator ([#1408](https://github.com/langwatch/langwatch/issues/1408)) ([ac18176](https://github.com/langwatch/langwatch/commit/ac18176b9889dc5dba16e62a089ce2c6f5bbe947))
* add observability and prompt MCP tools to @langwatch/mcp-server v0.4.0 ([#1410](https://github.com/langwatch/langwatch/issues/1410)) ([b770040](https://github.com/langwatch/langwatch/commit/b7700401dd87e7f1b76fefb213d67c906bcc1202))
* add pii detection and redaction to event sourcing trace ingestion ([#1278](https://github.com/langwatch/langwatch/issues/1278)) ([71bcb49](https://github.com/langwatch/langwatch/commit/71bcb49c4c671209c612417615060ccc1cf1edf6))
* add PII reviewer agent ([#1423](https://github.com/langwatch/langwatch/issues/1423)) ([ad1b56d](https://github.com/langwatch/langwatch/commit/ad1b56d2d77366e5c701485f659a950d330a16bc))
* added topic clustering to trace processing event sourcing pipeline ([#1275](https://github.com/langwatch/langwatch/issues/1275)) ([3a0a094](https://github.com/langwatch/langwatch/commit/3a0a0946e80c1c55e6035a90cc2167d15514832d))
* **agents:** add /test-review skill and integrate into orchestration ([#1297](https://github.com/langwatch/langwatch/issues/1297)) ([4328510](https://github.com/langwatch/langwatch/commit/43285101c0d816d6779521ff2d30c4423873b7d4)), closes [#1295](https://github.com/langwatch/langwatch/issues/1295)
* **automations:** rename triggers to automations, add code mode for customizing automation, improve filters ([#1317](https://github.com/langwatch/langwatch/issues/1317)) ([8624850](https://github.com/langwatch/langwatch/commit/862485076dc927bc60ccb27ca2db22dd05837d45))
* enable clickhouse trace ingestion as default for new projects ([#1368](https://github.com/langwatch/langwatch/issues/1368)) ([7c5f86e](https://github.com/langwatch/langwatch/commit/7c5f86ebf5bd8afc8ef4b0ba91a69e662aba8dbc))
* enable reusable testcontainers for faster integration tests ([#1302](https://github.com/langwatch/langwatch/issues/1302)) ([d9b065c](https://github.com/langwatch/langwatch/commit/d9b065cef7ea10510eb76fcfb9384ed37bc32add))
* **evaluations-v3:** evaluate your evaluator on workbench, workflow evaluators, and smashing several evaluations workbench bugs ([#1269](https://github.com/langwatch/langwatch/issues/1269)) ([476aed6](https://github.com/langwatch/langwatch/commit/476aed648627f46b6ed1b21dec9a895a1cb6017e))
* expose feature flags to frontend via session ([#1218](https://github.com/langwatch/langwatch/issues/1218)) ([94beed1](https://github.com/langwatch/langwatch/commit/94beed1ab296d52aa989615ac44139230d479773))
* full trace (AI-Readable) mapping source for online evaluations ([#1395](https://github.com/langwatch/langwatch/issues/1395)) ([9e6b5a1](https://github.com/langwatch/langwatch/commit/9e6b5a11d56138ad7c047f0905aa34656ea30baa))
* **licensing:** add enterprise blockers for datasets, dashboards, graphs, and automations ([#1316](https://github.com/langwatch/langwatch/issues/1316)) ([a0c0ef3](https://github.com/langwatch/langwatch/commit/a0c0ef39005f8e29e77c41e053167ccfc2d2b7f7))
* **licensing:** add experiment limits and improve member naming ([#1256](https://github.com/langwatch/langwatch/issues/1256)) ([cac6894](https://github.com/langwatch/langwatch/commit/cac68947d946d9cac43c5c15a9bd97ea3fa05cfe))
* otel genai input output messages ([#1416](https://github.com/langwatch/langwatch/issues/1416)) ([6906b7f](https://github.com/langwatch/langwatch/commit/6906b7fb2bbb368c72fcf5421a8f9016d56656f3))
* pass thread_id through execute_component to LangWatch tracing ([ac986cc](https://github.com/langwatch/langwatch/commit/ac986cc3ca0e5e37fa8e71ae304e2cad63cb6b14))
* **python-sdk:** add prompts_path configuration to setup() ([#1271](https://github.com/langwatch/langwatch/issues/1271)) ([49cfa7c](https://github.com/langwatch/langwatch/commit/49cfa7c30335a6fd007fbaa156f272f2419af11a))
* re-apply frontend feature flags ([#1257](https://github.com/langwatch/langwatch/issues/1257)) ([50076b7](https://github.com/langwatch/langwatch/commit/50076b7bfe8a5b2bd6e7688917993336935b1f82))
* redesign trace details evaluations tab and fix thread mappings ([#1393](https://github.com/langwatch/langwatch/issues/1393)) ([a2ceaea](https://github.com/langwatch/langwatch/commit/a2ceaea3742ee9e611914d82a58f2e340e1879dc))
* replace search bar with new command bar ([#1245](https://github.com/langwatch/langwatch/issues/1245)) ([15d9827](https://github.com/langwatch/langwatch/commit/15d982756e0d2830245c3db146da82aa7a164de7))
* **scenarios:** create AI Create Modal for scenario generation ([#1268](https://github.com/langwatch/langwatch/issues/1268)) ([d9af4c5](https://github.com/langwatch/langwatch/commit/d9af4c58d885873e3032a1bbc6ec4508e9861638))
* **scenarios:** display friendly name for internal scenario sets ([#1362](https://github.com/langwatch/langwatch/issues/1362)) ([5f2877f](https://github.com/langwatch/langwatch/commit/5f2877ff4b1971e9693feded1e52237cf326936c))
* **scenarios:** isolated OTEL traces for server-side execution ([#1134](https://github.com/langwatch/langwatch/issues/1134)) ([bc46411](https://github.com/langwatch/langwatch/commit/bc46411c54f0b5d521102bc10ba73730f233620d))
* **scenarios:** replace local-scenarios with internal namespace pattern ([#1347](https://github.com/langwatch/langwatch/issues/1347)) ([d4305ea](https://github.com/langwatch/langwatch/commit/d4305eac4150f90bc8bab5bad09840f8c180000b))
* warn user when no model providers configured for AI scenario creation ([#1348](https://github.com/langwatch/langwatch/issues/1348)) ([49e6331](https://github.com/langwatch/langwatch/commit/49e6331d1421e16b5d23382e3ce753e58a45090e))


### Bug Fixes

* add bullmq metrics, and also stop sending old job format in event sourcing ([#1406](https://github.com/langwatch/langwatch/issues/1406)) ([2abbf29](https://github.com/langwatch/langwatch/commit/2abbf2912441a8c37b922ceb9d5e385a0e36dcb6))
* add CI ([#788](https://github.com/langwatch/langwatch/issues/788)) ([71da835](https://github.com/langwatch/langwatch/commit/71da83545d475a90f388aefcaf1bd356b5d752f0))
* **agents:** restore simplified test-reviewer.md ([#1305](https://github.com/langwatch/langwatch/issues/1305)) ([5d9ed6f](https://github.com/langwatch/langwatch/commit/5d9ed6f2c98e7fdf544cdce02f813d5df85f80fe))
* allow back to start workers together with server, fix for docker compose, return back to single start script ([30d55cb](https://github.com/langwatch/langwatch/commit/30d55cb9d13de52eca403e3cfe78d813e4d93fc4))
* change how context is propagated though jobs ([#1377](https://github.com/langwatch/langwatch/issues/1377)) ([73fc13e](https://github.com/langwatch/langwatch/commit/73fc13ee60f5f3d0b97af2c6c8486d7c509bff25))
* **claude:** correct worktree skill paths for langwatch repo ([#1262](https://github.com/langwatch/langwatch/issues/1262)) ([c94b1a7](https://github.com/langwatch/langwatch/commit/c94b1a755a2ab28f1b088faefae2f3c81f90ee4a))
* clean up event sourcing initialization  ([#1273](https://github.com/langwatch/langwatch/issues/1273)) ([f492b1a](https://github.com/langwatch/langwatch/commit/f492b1af08d94f61474c0490217f2df2a40a5775))
* click propagation was causing dialogs to click parents ([#1364](https://github.com/langwatch/langwatch/issues/1364)) ([81bb778](https://github.com/langwatch/langwatch/commit/81bb7788fdb9fbe177afad886b1223772786af0f))
* dev logging caused listener pollution, and improve logging more ([#1373](https://github.com/langwatch/langwatch/issues/1373)) ([9962b7c](https://github.com/langwatch/langwatch/commit/9962b7c38ccd8db1d98953fdc9c58654c689d02e))
* **docker:** add shared pnpm store for faster Docker installs ([#1299](https://github.com/langwatch/langwatch/issues/1299)) ([ac7017d](https://github.com/langwatch/langwatch/commit/ac7017d3b34ba0fdb528120334617b203b95094b))
* evaluation schema and logging ([#1394](https://github.com/langwatch/langwatch/issues/1394)) ([c7b8a94](https://github.com/langwatch/langwatch/commit/c7b8a9414abd48e7e18a7b4a1916bd9d2bc5242d))
* evaluator-as-target batch eval header icon and update uv lock file for langwatch_nlp ([33cfa86](https://github.com/langwatch/langwatch/commit/33cfa86b64cdb743c88446ebb1eb8979196c5e4c))
* event sourcing init across module boundaries ([#1277](https://github.com/langwatch/langwatch/issues/1277)) ([94fffcf](https://github.com/langwatch/langwatch/commit/94fffcf3e7e90d2dbd15a9b44703b2e84fc8b760))
* event sourcing logging issues due to error instance checks not being possible ([#1307](https://github.com/langwatch/langwatch/issues/1307)) ([c0da41b](https://github.com/langwatch/langwatch/commit/c0da41b679bc5caaef71f9747dee502d26de40e1))
* extract input/output text from json arrays of chat-message-like objects ([7fef464](https://github.com/langwatch/langwatch/commit/7fef464a7e5d6968cf808803ede1d71d3c8dec67))
* fix cascadeArchive integration tests ([1138da2](https://github.com/langwatch/langwatch/commit/1138da2ed4cdb6a56e4f9673eaabf4407a80f307))
* fix failing unit and integration tests ([#1281](https://github.com/langwatch/langwatch/issues/1281)) ([676ca66](https://github.com/langwatch/langwatch/commit/676ca668e047129482099610e4f7b5d85bded5d1))
* guard against -Infinity in CustomGraph maxValue when data is empty ([8a86fc5](https://github.com/langwatch/langwatch/commit/8a86fc5061442a4b7d4a6fd59c47246da321a896))
* improve evaluations empty state and update documentation links ([dca1c14](https://github.com/langwatch/langwatch/commit/dca1c145fb56e503bfeefaf9103d804e0d7d9ada))
* improve rendering for high limits, render new license button for ourselves for IS_SAAS ([3187333](https://github.com/langwatch/langwatch/commit/31873338672f1058d61c054eb544597fd7e438ad))
* **model-providers:** save API key when switching from env vars to custom ([#1191](https://github.com/langwatch/langwatch/issues/1191)) ([a1f9699](https://github.com/langwatch/langwatch/commit/a1f9699be01d1e1ced14bc38d000a4700fdf0b53)), closes [#1186](https://github.com/langwatch/langwatch/issues/1186)
* moved pii detection check, and store in event/command ([#1293](https://github.com/langwatch/langwatch/issues/1293)) ([010eb6d](https://github.com/langwatch/langwatch/commit/010eb6dbab210ce367188c049adde26204d539aa))
* node engine version to 24 ([#1367](https://github.com/langwatch/langwatch/issues/1367)) ([39e6beb](https://github.com/langwatch/langwatch/commit/39e6bebc6dc2fe616f10eb458731b07356d884e8))
* prefer last user-role message when extracting input text from chat arrays ([9be5248](https://github.com/langwatch/langwatch/commit/9be524865b491b9094046fee0bb9a399657e1b74))
* **projects:** create project in correct organization from dropdown ([#1265](https://github.com/langwatch/langwatch/issues/1265)) ([53b4c84](https://github.com/langwatch/langwatch/commit/53b4c84feb714846698b520a252d3f1eb86a403e))
* **prompt-editor:** prevent race condition when switching targets ([#1358](https://github.com/langwatch/langwatch/issues/1358)) ([b6116a4](https://github.com/langwatch/langwatch/commit/b6116a4e68a4554d1b2fc05843844c917eb10b65))
* **python-sdk:** resolve prompt path at sdk setup ([#1272](https://github.com/langwatch/langwatch/issues/1272)) ([4daf6d0](https://github.com/langwatch/langwatch/commit/4daf6d023a7ac5bd2b519c0e34173298d1569ea2))
* rename scenario "Delete" to "Archive" in UI for honesty ([73ec200](https://github.com/langwatch/langwatch/commit/73ec2006c55469736ec421b2fc84ff3642fb8c62))
* rename scenario Delete to Archive in UI ([#1405](https://github.com/langwatch/langwatch/issues/1405)) ([73ec200](https://github.com/langwatch/langwatch/commit/73ec2006c55469736ec421b2fc84ff3642fb8c62))
* scenario worker fails immediately on worker death instead of retrying ([#1315](https://github.com/langwatch/langwatch/issues/1315)) ([e3353c1](https://github.com/langwatch/langwatch/commit/e3353c157e7a13e2eb3536cfc329d11b83ca9103))
* **scenarios:** use __dirname for reliable child process path resolution ([#1306](https://github.com/langwatch/langwatch/issues/1306)) ([11f9264](https://github.com/langwatch/langwatch/commit/11f9264b284b7c4649ee0b86f4b246432316564d))
* set `ensure_ascii` as false on all json.dumps inside NLP to support utf-8 encoding ([#1313](https://github.com/langwatch/langwatch/issues/1313)) ([e8db9a5](https://github.com/langwatch/langwatch/commit/e8db9a51e83e77c6be8e3e33cf6bc5c69c282bf6))
* skip command bar on admin and onboarding ([3b653c8](https://github.com/langwatch/langwatch/commit/3b653c8bafe0055ca64ef902687929b7ceb55c5b))
* skip keys that are not matching cold storage for batch evaluations ([59c9abb](https://github.com/langwatch/langwatch/commit/59c9abbf9999d37894f0c9143ddae3587420bcda))
* support air-gapped Docker builds ([#1242](https://github.com/langwatch/langwatch/issues/1242)) ([0b04919](https://github.com/langwatch/langwatch/commit/0b049198e2c8e87851783c547ce264d9e323b1cd))
* support air-gapped Docker builds with Prisma checksum skip ([0b04919](https://github.com/langwatch/langwatch/commit/0b049198e2c8e87851783c547ce264d9e323b1cd)), closes [#1241](https://github.com/langwatch/langwatch/issues/1241)
* **test:** configure enterprise license for integration tests ([17eb3dd](https://github.com/langwatch/langwatch/commit/17eb3dd3b13815f66ed012fae52961fc27c53586))
* tests, handle wildcard (*) in spans and metadata trace mappings and allow log_response() without explicit target context  ([#1291](https://github.com/langwatch/langwatch/issues/1291)) ([af5d77f](https://github.com/langwatch/langwatch/commit/af5d77fade37ea9ca157965e7d1ac8e4e73f2dcf))
* **tests:** add  cleanup for integration tests ([#1290](https://github.com/langwatch/langwatch/issues/1290)) ([17eb3dd](https://github.com/langwatch/langwatch/commit/17eb3dd3b13815f66ed012fae52961fc27c53586))
* **tests:** update license tests to match UI showing formatted numbers ([#1267](https://github.com/langwatch/langwatch/issues/1267)) ([4f62a04](https://github.com/langwatch/langwatch/commit/4f62a0411e7150bf19637028c3d41231318531e5))
* **tests:** update tests for New Prompt naming and rename .integration.test.tsx files ([822c8bb](https://github.com/langwatch/langwatch/commit/822c8bbd75c8ef34b2169fe4a458f627a23db18c))
* **tests:** update tests for New Prompt naming and rename .integration.test.tsx files ([417d961](https://github.com/langwatch/langwatch/commit/417d961fb96c7832a776a9f6a3c7702514d44e4b))
* **traces:** check IS_SAAS before DB calls in checkLimit ([#1251](https://github.com/langwatch/langwatch/issues/1251)) ([55442fb](https://github.com/langwatch/langwatch/commit/55442fbe0d010998d5781a2813c035a167eb757d)), closes [#1249](https://github.com/langwatch/langwatch/issues/1249)
* **traces:** enforce limits for self-hosted instances with licenses ([#1260](https://github.com/langwatch/langwatch/issues/1260)) ([3f65268](https://github.com/langwatch/langwatch/commit/3f652688ff71fb01b0dc588d04d2a2794c18a4b8))
* tracing on trpc, and more fixes from reading logs ([#1381](https://github.com/langwatch/langwatch/issues/1381)) ([53db3ef](https://github.com/langwatch/langwatch/commit/53db3efd2dd707df1014c2e5d5c926f3f1d90743))
* update BullMQ for Redis Cluster CROSSSLOT compatibility ([#1420](https://github.com/langwatch/langwatch/issues/1420)) ([b9f0840](https://github.com/langwatch/langwatch/commit/b9f0840e6fc4ed3b0eedc82fb7a63fb07967ab43))
* use nested pnpm task because for some reasone that prevents force kills to leave the server hanging in the background for better development experience ([7dff46c](https://github.com/langwatch/langwatch/commit/7dff46c7c350d026f9d305f94c6ab1880e3812fb))


### Miscellaneous

* add logging and project id to nlp logging ([#1374](https://github.com/langwatch/langwatch/issues/1374)) ([ff42237](https://github.com/langwatch/langwatch/commit/ff42237f325e424b8f329bf0e9b5b00f3e4f71b7))
* add more features to command bar, address comments from first pr ([#1255](https://github.com/langwatch/langwatch/issues/1255)) ([ae3819b](https://github.com/langwatch/langwatch/commit/ae3819b982cb87ceaa89697965c7b3e07a929cac))
* address errors from logs, and cleanup some misguided error levels ([#1365](https://github.com/langwatch/langwatch/issues/1365)) ([d68e5fe](https://github.com/langwatch/langwatch/commit/d68e5fea6f72d50b9481544e71549d2182e41c26))
* fully remove permission and use rbac ([#1263](https://github.com/langwatch/langwatch/issues/1263)) ([13bc6bf](https://github.com/langwatch/langwatch/commit/13bc6bf52226160dfb232e059ac0b169ab874dcf))
* improve build times ([#1344](https://github.com/langwatch/langwatch/issues/1344)) ([5efd5d6](https://github.com/langwatch/langwatch/commit/5efd5d6128834f72425a15bb4daa132d7d78135a))
* improve logging, telemetry, metrics across the entire platform ([#1253](https://github.com/langwatch/langwatch/issues/1253)) ([370ca90](https://github.com/langwatch/langwatch/commit/370ca90773c62d8c9ada085b2c88fd4dfe1eaf89))
* **main:** release python-sdk 0.10.1 ([#1158](https://github.com/langwatch/langwatch/issues/1158)) ([254ddcc](https://github.com/langwatch/langwatch/commit/254ddcc8f50189d5ec3aebd7827ca0f3ec85ecb9))
* **main:** release python-sdk 0.10.2 ([#1292](https://github.com/langwatch/langwatch/issues/1292)) ([47f463d](https://github.com/langwatch/langwatch/commit/47f463d7e428c21b91d25c35cc4e419261b39329))
* new readme ([#1304](https://github.com/langwatch/langwatch/issues/1304)) ([d50f0f1](https://github.com/langwatch/langwatch/commit/d50f0f1d5a77187607479f6dc8fc9fc0bd7d3f63))
* remove duplicate .claude directory from langwatch/ ([#1283](https://github.com/langwatch/langwatch/issues/1283)) ([bdfb432](https://github.com/langwatch/langwatch/commit/bdfb432fcf0f581b809d28bec430700392d1d7a1)), closes [#1282](https://github.com/langwatch/langwatch/issues/1282)
* remove script since migration is done ([#1424](https://github.com/langwatch/langwatch/issues/1424)) ([3c4ee83](https://github.com/langwatch/langwatch/commit/3c4ee83fbcd7257bcf45d72a3ce36451312ef51f))
* remove worktree command from repo ([#1355](https://github.com/langwatch/langwatch/issues/1355)) ([2793f48](https://github.com/langwatch/langwatch/commit/2793f487abb14a7e92537570dd6af939b7e383f3))
* require user approval on feature file before implementation ([#1342](https://github.com/langwatch/langwatch/issues/1342)) ([90a2511](https://github.com/langwatch/langwatch/commit/90a2511be97697e00461ac83805373306001e5b7))
* update to node 25 ([#1301](https://github.com/langwatch/langwatch/issues/1301)) ([94b5e5e](https://github.com/langwatch/langwatch/commit/94b5e5e7dd219cc0fe2b498b198c46ffda10dd3c))
* use node 24-lts ([#1346](https://github.com/langwatch/langwatch/issues/1346)) ([9f607d2](https://github.com/langwatch/langwatch/commit/9f607d2cf702a6b85957b5d5965647c4f1c160c5))


### Documentation

* add generic "build on existing patterns" guidance ([6bad2f1](https://github.com/langwatch/langwatch/commit/6bad2f1a6635f55d9ad77d93b4a359e5568b66a1)), closes [#1213](https://github.com/langwatch/langwatch/issues/1213)
* add search-before-building guidance to plan skill ([#1214](https://github.com/langwatch/langwatch/issues/1214)) ([6bad2f1](https://github.com/langwatch/langwatch/commit/6bad2f1a6635f55d9ad77d93b4a359e5568b66a1))


### Code Refactoring

* **licensing:** remove LICENSE_ENFORCEMENT_ENABLED env var from specs ([#1380](https://github.com/langwatch/langwatch/issues/1380)) ([7c1a483](https://github.com/langwatch/langwatch/commit/7c1a483b3626a6db64ff08ef4a6a9bc808ae3aac))
* migrate python-sdk prompts to Pydantic + walk up directory tree for prompts.json ([#1392](https://github.com/langwatch/langwatch/issues/1392)) ([66cb286](https://github.com/langwatch/langwatch/commit/66cb286a853964be3d614a509d08a9f38126b42b))

## [2.0.2](https://github.com/langwatch/langwatch/compare/langwatch@v2.0.1...langwatch@v2.0.2) (2026-01-28)


### Bug Fixes

* **tests:** load .env at config time for stress tests ([643f2dc](https://github.com/langwatch/langwatch/commit/643f2dc08a210d33f21dbdd0da79650ea1369490))
* **traces:** check plan before bypassing trace limits for self-hosted ([#1244](https://github.com/langwatch/langwatch/issues/1244)) ([6ce3e0d](https://github.com/langwatch/langwatch/commit/6ce3e0d01c7b703bf0b54163891696744c2d92fd))

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
