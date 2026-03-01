# Changelog

## [0.14.0](https://github.com/langwatch/langwatch/compare/python-sdk@v0.13.0...python-sdk@v0.14.0) (2026-03-01)


### Features

* **examples:** add metadata and labels examples for TypeScript and Python SDKs ([#1585](https://github.com/langwatch/langwatch/issues/1585)) ([7d09ab8](https://github.com/langwatch/langwatch/commit/7d09ab805146542921e8b1f1258d5e6e59462bfe))

## [0.13.0](https://github.com/langwatch/langwatch/compare/python-sdk@v0.12.0...python-sdk@v0.13.0) (2026-02-15)


### Features

* add POST /api/evaluators to create evaluators via REST API ([#1574](https://github.com/langwatch/langwatch/issues/1574)) ([3084655](https://github.com/langwatch/langwatch/commit/308465566db22345663ba78135338ad587e8d84d))
* full Liquid template support with autocomplete ([#1583](https://github.com/langwatch/langwatch/issues/1583)) ([00863a7](https://github.com/langwatch/langwatch/commit/00863a7643c8f6af48582bf82512fd37391902a7))

## [0.12.0](https://github.com/langwatch/langwatch/compare/python-sdk@v0.11.0...python-sdk@v0.12.0) (2026-02-13)


### Features

* **cli:** add separate prompt pull and prompt push commands ([#1543](https://github.com/langwatch/langwatch/issues/1543)) ([76c4881](https://github.com/langwatch/langwatch/commit/76c48817d284b300b33a37bbc52c4047bff8e36e))


### Bug Fixes

* handle NaN/Infinity in JSON serialization for batch evaluation payloads ([#1557](https://github.com/langwatch/langwatch/issues/1557)) ([072c347](https://github.com/langwatch/langwatch/commit/072c347ca3ba7c148ae19d0d9e3fc80f6d6c84fc))
* handle NaN/Infinity in JSON serialization for batch evaluation payloads ([#1558](https://github.com/langwatch/langwatch/issues/1558)) ([072c347](https://github.com/langwatch/langwatch/commit/072c347ca3ba7c148ae19d0d9e3fc80f6d6c84fc))


### Miscellaneous

* **deps-dev:** bump chainlit from 2.8.3 to 2.9.6 in /python-sdk ([#1508](https://github.com/langwatch/langwatch/issues/1508)) ([5cdb91a](https://github.com/langwatch/langwatch/commit/5cdb91a628442b747eb776978156c5531ab80f61))
* **deps-dev:** bump json-repair from 0.49.0 to 0.57.1 in /python-sdk ([#1507](https://github.com/langwatch/langwatch/issues/1507)) ([eb681e5](https://github.com/langwatch/langwatch/commit/eb681e5d5d341aee61fc9eed7236d9d40168c6ff))
* **deps-dev:** bump openinference-instrumentation-dspy from 0.1.28 to 0.1.33 in /python-sdk ([#1505](https://github.com/langwatch/langwatch/issues/1505)) ([1280b4c](https://github.com/langwatch/langwatch/commit/1280b4cab9e67ce2976837a6244588d8cfdfd814))
* **deps-dev:** bump openinference-instrumentation-dspy in /python-sdk ([1280b4c](https://github.com/langwatch/langwatch/commit/1280b4cab9e67ce2976837a6244588d8cfdfd814))
* **deps-dev:** bump python-dotenv from 1.0.1 to 1.2.1 in /python-sdk ([#1509](https://github.com/langwatch/langwatch/issues/1509)) ([01d4a17](https://github.com/langwatch/langwatch/commit/01d4a171ae4b6253d82e157d477ecac58d3de25f))
* **deps-dev:** update uvicorn requirement from &lt;0.40.0,&gt;=0.38.0 to &gt;=0.38.0,&lt;0.41.0 in /python-sdk ([#1445](https://github.com/langwatch/langwatch/issues/1445)) ([a26937d](https://github.com/langwatch/langwatch/commit/a26937df10f8dd39f93c79532d42a681fffb73d9))
* **deps-dev:** update uvicorn requirement in /python-sdk ([a26937d](https://github.com/langwatch/langwatch/commit/a26937df10f8dd39f93c79532d42a681fffb73d9))

## [0.11.0](https://github.com/langwatch/langwatch/compare/python-sdk@v0.10.2...python-sdk@v0.11.0) (2026-02-12)


### Features

* add library to help catch trace parity dift betwen ElasicSearch and ClickHouse ([#1426](https://github.com/langwatch/langwatch/issues/1426)) ([bce70bf](https://github.com/langwatch/langwatch/commit/bce70bfe453a9202414e17afa8018786fe3d225f))
* add public REST API for evaluators ([#1540](https://github.com/langwatch/langwatch/issues/1540)) ([46f4064](https://github.com/langwatch/langwatch/commit/46f4064c32dee33be58eee54f98c810a0da57cee))
* add public REST API for evaluators (/api/evaluators) ([46f4064](https://github.com/langwatch/langwatch/commit/46f4064c32dee33be58eee54f98c810a0da57cee))
* pass thread_id through execute_component to LangWatch tracing ([ac986cc](https://github.com/langwatch/langwatch/commit/ac986cc3ca0e5e37fa8e71ae304e2cad63cb6b14))


### Bug Fixes

* use z.date() for evaluator schema dates to match Prisma output ([3b5041a](https://github.com/langwatch/langwatch/commit/3b5041a93c3b18f2c3c3cdb6713abdd567bad3e2))


### Miscellaneous

* **deps:** bump ruff from 0.12.9 to 0.15.0 in /python-sdk ([#1506](https://github.com/langwatch/langwatch/issues/1506)) ([89b6fb3](https://github.com/langwatch/langwatch/commit/89b6fb32a1571b87e3c7f963fa6e565b3063b8f1))


### Code Refactoring

* migrate python-sdk prompts to Pydantic + walk up directory tree for prompts.json ([#1392](https://github.com/langwatch/langwatch/issues/1392)) ([66cb286](https://github.com/langwatch/langwatch/commit/66cb286a853964be3d614a509d08a9f38126b42b))

## [0.10.2](https://github.com/langwatch/langwatch/compare/python-sdk@v0.10.1...python-sdk@v0.10.2) (2026-02-05)


### Bug Fixes

* tests, handle wildcard (*) in spans and metadata trace mappings and allow log_response() without explicit target context  ([#1291](https://github.com/langwatch/langwatch/issues/1291)) ([af5d77f](https://github.com/langwatch/langwatch/commit/af5d77fade37ea9ca157965e7d1ac8e4e73f2dcf))

## [1.0.0](https://github.com/langwatch/langwatch/compare/python-sdk@v0.10.0...python-sdk@v1.0.0) (2026-02-01)


### ⚠ BREAKING CHANGES

* Monitors now store evaluation level explicitly in 'level' column

### Features

* **evaluations-v3:** major table performance improvements, prompts to experiment button and other bugfixes ([#1181](https://github.com/langwatch/langwatch/issues/1181)) ([2cbf430](https://github.com/langwatch/langwatch/commit/2cbf4303f670edcd65a81f3af4d7a00a85b13010))
* new online evaluations and guardrails setup ([#1151](https://github.com/langwatch/langwatch/issues/1151)) ([7c8a804](https://github.com/langwatch/langwatch/commit/7c8a804e265946a9a96e44b110f17266abaafc73))
* **python-sdk:** add prompts_path configuration to setup() ([#1271](https://github.com/langwatch/langwatch/issues/1271)) ([49cfa7c](https://github.com/langwatch/langwatch/commit/49cfa7c30335a6fd007fbaa156f272f2419af11a))
* **traces:** add reasoning tokens and effort support for LLM models ([16f1d4a](https://github.com/langwatch/langwatch/commit/16f1d4a80f1425d85c5f700da01287a2415bdd88))


### Bug Fixes

* **dspy:** capture full message output including reasoning_content ([8257cae](https://github.com/langwatch/langwatch/commit/8257cae1b9a4dbe8be8e7001fa88d7a0e3de6653))
* **python-sdk:** resolve prompt path at sdk setup ([#1272](https://github.com/langwatch/langwatch/issues/1272)) ([4daf6d0](https://github.com/langwatch/langwatch/commit/4daf6d023a7ac5bd2b519c0e34173298d1569ea2))


### Documentation

* move TESTING.md to docs/TESTING_PHILOSOPHY.md ([#1157](https://github.com/langwatch/langwatch/issues/1157)) ([c475c86](https://github.com/langwatch/langwatch/commit/c475c8692f461dc737a082ca687db101a74be9fb))

## [0.10.0](https://github.com/langwatch/langwatch/compare/python-sdk@v0.9.0...python-sdk@v0.10.0) (2026-01-21)


### Features

* **sdk:** add online evaluations API and ensureSetup for TypeScript ([2209258](https://github.com/langwatch/langwatch/commit/22092580433b9a3014123e62f39cf8c44543d8cc))


### Bug Fixes

* **python-sdk:** resolve name collision between Evaluation TypedDict and class alias ([873909a](https://github.com/langwatch/langwatch/commit/873909a09414bb309fa955b68e4a19bddc93e21f))


### Code Refactoring

* **sdk:** fix evaluation API naming consistency ([3aef2a3](https://github.com/langwatch/langwatch/commit/3aef2a353cc4939c8087b53044f441e7501530ae))
* **sdk:** rename evaluation API to experiment for new terminology ([f10326c](https://github.com/langwatch/langwatch/commit/f10326c0f2ee5818fbcf51507a95933bfe83caeb))
* **sdk:** rename internal evaluation classes to experiment ([ff70cab](https://github.com/langwatch/langwatch/commit/ff70cab904905b85a77a68e7b1eb60e9c364a18d))

## [0.9.0](https://github.com/langwatch/langwatch/compare/python-sdk@v0.8.1...python-sdk@v0.9.0) (2026-01-18)


### Features

* add CI/CD execution support for evaluations v3 ([#1118](https://github.com/langwatch/langwatch/issues/1118)) ([d28adac](https://github.com/langwatch/langwatch/commit/d28adaceeb87921d9c7c0f1cf76b5e03f3b90fbd))
* evaluations v3 execution and new evaluations results page ([#1113](https://github.com/langwatch/langwatch/issues/1113)) ([510f65d](https://github.com/langwatch/langwatch/commit/510f65d17e13c539b877e7eed2fefff118ceb705))


### Bug Fixes

* various evaluations v3 fixes ([#1122](https://github.com/langwatch/langwatch/issues/1122)) ([c9904fc](https://github.com/langwatch/langwatch/commit/c9904fc898a7982ec0b23b11fcfeed83f34fbeb7))

## [0.8.1](https://github.com/langwatch/langwatch/compare/python-sdk@v0.8.0...python-sdk@v0.8.1) (2026-01-06)


### Bug Fixes

* improve backend error capturing of whole python-sdk to forward the human readable error message, and improve auto parsing of contexts for evaluation ([7ed0623](https://github.com/langwatch/langwatch/commit/7ed06235ecf14091c4cad33a5331a4d0819e9a27))
* reraise when 'error' is not available ([40530a2](https://github.com/langwatch/langwatch/commit/40530a2de08ce796dcc4ad9a0a97cd661044dbf1))


### Miscellaneous

* trigger release ([#1011](https://github.com/langwatch/langwatch/issues/1011)) ([6173f53](https://github.com/langwatch/langwatch/commit/6173f53b041d9ee7e6b930270224954ba3c6621e))

## [0.8.0](https://github.com/langwatch/langwatch/compare/python-sdk@v0.7.2...python-sdk@v0.8.0) (2025-12-16)


### Features

* implement FetchPolicy enum for Python SDK  ([#989](https://github.com/langwatch/langwatch/issues/989)) ([43de904](https://github.com/langwatch/langwatch/commit/43de904de08ec54a78aece35da155a8a3cb4289d))

### Bug Fixes

* rerun evaluations if new spans arrive even after 30s but less than 1h ([79ba316](https://github.com/langwatch/langwatch/commit/79ba3163c64f224e3d2b640b5340f1503fc57c48))

## [0.7.2](https://github.com/langwatch/langwatch/compare/python-sdk@v0.7.1...python-sdk@v0.7.2) (2025-12-03)


### Bug Fixes

* **python-sdk:** add httpx.ReadTimeout to transient error skip list ([#910](https://github.com/langwatch/langwatch/issues/910)) ([dbdae14](https://github.com/langwatch/langwatch/commit/dbdae1465b5da364aa23097d9d91ff2072ee6d13)), closes [#909](https://github.com/langwatch/langwatch/issues/909)

## [0.7.1](https://github.com/langwatch/langwatch/compare/python-sdk@v0.7.0...python-sdk@v0.7.1) (2025-11-28)


### Bug Fixes

* **prompts:** make prompts.get throw error instead of returning null/undefined ([#867](https://github.com/langwatch/langwatch/issues/867)) ([9705201](https://github.com/langwatch/langwatch/commit/97052015061f40fc63069c78bb1e702cbf12fa29))

## [0.7.0](https://github.com/langwatch/langwatch/compare/python-sdk@v0.6.1...python-sdk@v0.7.0) (2025-11-05)


### Features

* support langchain/langgraph 1.0.0 in python sdk ([#780](https://github.com/langwatch/langwatch/issues/780)) ([70d4814](https://github.com/langwatch/langwatch/commit/70d4814528465d8e58d1ab4f82849ea13d6f564d))


### Bug Fixes

* parsing of Long values comming from Strands, add support for gen_ai.server.time_to_first_token ([c060766](https://github.com/langwatch/langwatch/commit/c060766fa093a6c6a881244267c1ed9929c9246b))

## [0.6.1](https://github.com/langwatch/langwatch/compare/python-sdk@v0.6.0...python-sdk@v0.6.1) (2025-10-31)


### Bug Fixes

* dataset slug name sync ([#759](https://github.com/langwatch/langwatch/issues/759)) ([d9f87e4](https://github.com/langwatch/langwatch/commit/d9f87e4dc4df610e876f931094d3e86f2c5254d1))

## [0.6.0](https://github.com/langwatch/langwatch/compare/python-sdk@v0.5.1...python-sdk@v0.6.0) (2025-10-31)


### Features

* upgrade to dspy v3 ([9833bbb](https://github.com/langwatch/langwatch/commit/9833bbb2b1e1c210350dbea6c502a8f0e624badc))
* upgrade to DSPy v3 🎉 ([#752](https://github.com/langwatch/langwatch/issues/752)) ([9833bbb](https://github.com/langwatch/langwatch/commit/9833bbb2b1e1c210350dbea6c502a8f0e624badc))


### Bug Fixes

* dataset routes ([#756](https://github.com/langwatch/langwatch/issues/756)) ([da736e0](https://github.com/langwatch/langwatch/commit/da736e025280208ceed620cd1bb8c43366120f0e))

## [0.5.1](https://github.com/langwatch/langwatch/compare/python-sdk@v0.5.0...python-sdk@v0.5.1) (2025-10-24)


### Miscellaneous

* add span count and weight details for better debugging of immense traces ([2be915e](https://github.com/langwatch/langwatch/commit/2be915e1735c0632caac8d8082f632d461643967))

## [0.5.0](https://github.com/langwatch/langwatch/compare/python-sdk@v0.4.2...python-sdk@v0.5.0) (2025-10-13)


### Features

* add support for otel /metrics endpoint for genai metrics ([#680](https://github.com/langwatch/langwatch/issues/680)) ([14bec0d](https://github.com/langwatch/langwatch/commit/14bec0d70d4c645d409b2b18a8f6219515563aed))


### Miscellaneous

* update to allow first_token_ms ([#702](https://github.com/langwatch/langwatch/issues/702)) ([38ffd34](https://github.com/langwatch/langwatch/commit/38ffd34f90e49c866690747c0e36b43a867cc698))
* update version 0.5 ([#704](https://github.com/langwatch/langwatch/issues/704)) ([615510f](https://github.com/langwatch/langwatch/commit/615510fa04ebe3c33635d0edcd3e8f7faeaabb52))

## [0.4.2](https://github.com/langwatch/langwatch/compare/python-sdk@v0.4.1...python-sdk@v0.4.2) (2025-09-22)


### Bug Fixes

* downgrade litellm dependency due to https://github.com/BerriAI/litellm/issues/14145 preventing to build it on lambda ([066d97c](https://github.com/langwatch/langwatch/commit/066d97c26252c82f9143e36427782c7af19912a2))

## [0.4.1](https://github.com/langwatch/langwatch/compare/python-sdk@v0.4.0...python-sdk@v0.4.1) (2025-09-19)


### Bug Fixes

* prompt tracing ([#653](https://github.com/langwatch/langwatch/issues/653)) ([9d39650](https://github.com/langwatch/langwatch/commit/9d39650435d6f32f040838935a89c037e47124f6))

## [0.4.0](https://github.com/langwatch/langwatch/compare/python-sdk@v0.3.2...python-sdk@v0.4.0) (2025-09-19)


### Features

* add crewai open telemetry  ([#549](https://github.com/langwatch/langwatch/issues/549)) ([e47bc67](https://github.com/langwatch/langwatch/commit/e47bc67135cc6019ddc67a89d610b92a81ed2c10))
* allow to set the run_id manually ([93417de](https://github.com/langwatch/langwatch/commit/93417de88e4115bf63edf8b83976d0ffd98954a4))
* allow to track dspy evaluators as well (by @WSJUSA) ([#488](https://github.com/langwatch/langwatch/issues/488)) ([1b79275](https://github.com/langwatch/langwatch/commit/1b792750000fdc2295962699823ae24a3ec0354c))
* bump it all from gpt-4o-mini to gpt-5 ([e2fb8bb](https://github.com/langwatch/langwatch/commit/e2fb8bb95048807b4a9d5713d41e6559e72da012))
* expand prompts support in python sdk ([#540](https://github.com/langwatch/langwatch/issues/540)) ([f7cd8b2](https://github.com/langwatch/langwatch/commit/f7cd8b233258df270a0f383052a4349b587e8b8d))
* guaranteed availability python ([#633](https://github.com/langwatch/langwatch/issues/633)) ([1818542](https://github.com/langwatch/langwatch/commit/1818542bdacced509a66465c5641f33572fafe3c))
* prompt handle UI ([#516](https://github.com/langwatch/langwatch/issues/516)) ([d812ed9](https://github.com/langwatch/langwatch/commit/d812ed92601b3114bd53cd90ba37f0d9a58d8bf7))
* python sdk tracing improvements ([#572](https://github.com/langwatch/langwatch/issues/572)) ([8448ed1](https://github.com/langwatch/langwatch/commit/8448ed1facebfffd367f3105f816bb985a2ffcef))
* support getting prompt with version number in python sdk ([#563](https://github.com/langwatch/langwatch/issues/563)) ([119cc2b](https://github.com/langwatch/langwatch/commit/119cc2bff3e232d9e0ec3f0c36c9ebd2a63967e7))
* workflow get dataset from api ([#405](https://github.com/langwatch/langwatch/issues/405)) ([705d3f1](https://github.com/langwatch/langwatch/commit/705d3f1a65fa4a8f462434a8f5ea1084b97aff16))


### Bug Fixes

* add missing dependency for langwatch ([93b66cc](https://github.com/langwatch/langwatch/commit/93b66cc466c669bc08ddb3ceeda829f6cd79cbad))
* add pyyaml as dep ([#648](https://github.com/langwatch/langwatch/issues/648)) ([083f7bd](https://github.com/langwatch/langwatch/commit/083f7bd8acdaffc1480c3b77c7afe9ec09b04389))
* add setting to batch evals ([#551](https://github.com/langwatch/langwatch/issues/551)) ([0b2cff6](https://github.com/langwatch/langwatch/commit/0b2cff6bcbd4edbf5e2485217d8cc6d92bca5087))
* copro logger patching in dspy ([#465](https://github.com/langwatch/langwatch/issues/465)) ([4cec023](https://github.com/langwatch/langwatch/commit/4cec023afd274bf2983fb26ce2a094d08b836d31))
* disallow non-named params to avoid confusing users ([#565](https://github.com/langwatch/langwatch/issues/565)) ([92fbeb7](https://github.com/langwatch/langwatch/commit/92fbeb7c48daffdc2c054b1cb0402e86e84390ea))
* dspy optimization studio fixes for template adapter ([#477](https://github.com/langwatch/langwatch/issues/477)) ([1231a14](https://github.com/langwatch/langwatch/commit/1231a14c08fc2e9481728adb1d61a05eb12ac95e))
* get rid of context for tracking current span, rely exclusively on the opentelemetry one instead, fixing out-of-parent spans ([#595](https://github.com/langwatch/langwatch/issues/595)) ([ee41980](https://github.com/langwatch/langwatch/commit/ee41980453f380a4d2954970a6aed2061ebae9c8))
* helm improvements ([#450](https://github.com/langwatch/langwatch/issues/450)) ([d0a7da2](https://github.com/langwatch/langwatch/commit/d0a7da240b3a792fb2ae4e4465cd87d0388cb916))
* import `get_current_span` from the correct location in litellm autotrack ([#542](https://github.com/langwatch/langwatch/issues/542)) ([082869d](https://github.com/langwatch/langwatch/commit/082869d50c6f97fe9ffcf83eb097dad67e4c1900))
* missing attributes on trace ([#646](https://github.com/langwatch/langwatch/issues/646)) ([ac7ea8b](https://github.com/langwatch/langwatch/commit/ac7ea8b36ce903027fa5ea1970530f2420caec18))
* multithread tracing on python-sdk ([#411](https://github.com/langwatch/langwatch/issues/411)) ([4be3c19](https://github.com/langwatch/langwatch/commit/4be3c197735d4c9624686cd168bdcf15632c2c32))
* only trace if tracing is enabled ([3bfd454](https://github.com/langwatch/langwatch/commit/3bfd4542b6811bde92031f289db646e502e0ab85))
* prep for python-sdk@0.2.0rc5 ([#292](https://github.com/langwatch/langwatch/issues/292)) ([d380fcd](https://github.com/langwatch/langwatch/commit/d380fcd3d6e67259f39ee479beaad9f12d36ac3d))
* preparing python sdk rc3 ([#255](https://github.com/langwatch/langwatch/issues/255)) ([4f9a5db](https://github.com/langwatch/langwatch/commit/4f9a5dbdefc696168508be6c45701bc1761e98c4))
* processing json schema with enums on the studio and dspy lazy import ([#435](https://github.com/langwatch/langwatch/issues/435)) ([9fc6e1e](https://github.com/langwatch/langwatch/commit/9fc6e1e9af7de970b8b2d234012de326fd7727e8))
* python sdk preparation for rc3-pt2 ([#258](https://github.com/langwatch/langwatch/issues/258)) ([493bd77](https://github.com/langwatch/langwatch/commit/493bd77129a0624c963152a40e4194a1b0e777d1))
* python-sdk instrumentation no need to set current span as parent as that the default ([231c8a1](https://github.com/langwatch/langwatch/commit/231c8a15a77423f395bf254d8ba0e16a75ede807))
* remove dspy and litellm from being mandatory dependencies and update strands version ([#578](https://github.com/langwatch/langwatch/issues/578)) ([0af71f8](https://github.com/langwatch/langwatch/commit/0af71f89b64cde5a5dfbc6384a39784198f21a9e))
* replace nanoid with pksuid and remove it from openai tracer ([b4116d7](https://github.com/langwatch/langwatch/commit/b4116d704592e7e92ceee7e6a75b05b69e7596e3))
* set do_not_trace for custom evals and add a mutable way to disable sending at runtime, fixing problem of reused runtimes and infinite loops in a real time eval evaluating itself and tracing ([f7d3a9f](https://github.com/langwatch/langwatch/commit/f7d3a9fde30d95efb8341c895539dff6b722c688))
* set the api key properly on every event ([#419](https://github.com/langwatch/langwatch/issues/419)) ([b98b560](https://github.com/langwatch/langwatch/commit/b98b56098632b9c4f89980b37280a12d2e219977))
* simplify truncation logic ([2e65ca2](https://github.com/langwatch/langwatch/commit/2e65ca2cf1dbcdf656791827f577fd5d1f44902a))
* skip auto setup without api key ([#609](https://github.com/langwatch/langwatch/issues/609)) ([1753982](https://github.com/langwatch/langwatch/commit/1753982a8d62a48d6ead55246262acfacd4cecdc))
* span merging ([#615](https://github.com/langwatch/langwatch/issues/615)) ([e92eed0](https://github.com/langwatch/langwatch/commit/e92eed0d2fa146d4f7e53fb3ff8c416b3c7c5fa4))
* truncate and an utf-8 safer maner to ensure byte size limits ([3549421](https://github.com/langwatch/langwatch/commit/3549421c40c0e69de3fbdc33d45a372c8938d9fe))
* update nlp with latest python sdk ([#408](https://github.com/langwatch/langwatch/issues/408)) ([c0b64d1](https://github.com/langwatch/langwatch/commit/c0b64d185fa0669ea3985dc603b964584fa65fd4))
* update the metadata when multiple get_current_trace().update happens instead of replacing it ([13b6921](https://github.com/langwatch/langwatch/commit/13b692103db0b24b3c769998b156dcc87ebb92f1))


### Miscellaneous

* add google adk example ([#564](https://github.com/langwatch/langwatch/issues/564)) ([8165344](https://github.com/langwatch/langwatch/commit/8165344de410e0474ef9474b1b49f16033ed7e60))
* added more tests for client ([#418](https://github.com/langwatch/langwatch/issues/418)) ([e7b067b](https://github.com/langwatch/langwatch/commit/e7b067b9bf735f7feaf7f66fe4d6b27b3171243d))
* bump to v0.2.3 ([f648f4d](https://github.com/langwatch/langwatch/commit/f648f4dcbdb1cd87369d90e6ab756e652ab03e1e))
* metadata tests to catch regressions in the python sdk ([#452](https://github.com/langwatch/langwatch/issues/452)) ([ab32758](https://github.com/langwatch/langwatch/commit/ab327585e9782a0bfe0a324d1356c0e39c0e11fe))
* python sdk setup/trace improvements, and strands example update ([#581](https://github.com/langwatch/langwatch/issues/581)) ([95c1833](https://github.com/langwatch/langwatch/commit/95c18339e3228482c2e9d90babdd9828dc21250e))
* release main ([#639](https://github.com/langwatch/langwatch/issues/639)) ([662b654](https://github.com/langwatch/langwatch/commit/662b654e522b3453628b883a7009b3bf95ef8645))
* release main ([#644](https://github.com/langwatch/langwatch/issues/644)) ([702e5d1](https://github.com/langwatch/langwatch/commit/702e5d1120a635537e6e2d4c6817156debe366fb))
* update python sdk to support Python 3.13 ([#557](https://github.com/langwatch/langwatch/issues/557)) ([d982a80](https://github.com/langwatch/langwatch/commit/d982a807be867df52c75aadaa2fb479b81d794d4))
* update python version ([#552](https://github.com/langwatch/langwatch/issues/552)) ([14a2ea6](https://github.com/langwatch/langwatch/commit/14a2ea61297c1a690c8f1d4dbf31c31547bea41c))


### Documentation

* add pdf parsing evaluation example ([0e5bd93](https://github.com/langwatch/langwatch/commit/0e5bd93735c4a5ee815d54962955aa75e3bb996b))
* update offline evaluation example with an image ([509f00b](https://github.com/langwatch/langwatch/commit/509f00b297f4356e2598cacfc1741f030f99dacf))


### Code Refactoring

* improved type safety and SRP services ([#611](https://github.com/langwatch/langwatch/issues/611)) ([1270e4b](https://github.com/langwatch/langwatch/commit/1270e4b1ef3447d65d2d0fb9b5264a3d5a727547))
* split collector and processor helathchecks endpoints ([#399](https://github.com/langwatch/langwatch/issues/399)) ([0eefbe5](https://github.com/langwatch/langwatch/commit/0eefbe52aa56dea45d3f8526d120f0f7c3c53843))

## [0.3.1](https://github.com/langwatch/langwatch/compare/python-sdk@v0.3.0...python-sdk@v0.3.1) (2025-09-19)


### Bug Fixes

* missing attributes on trace ([#646](https://github.com/langwatch/langwatch/issues/646)) ([ac7ea8b](https://github.com/langwatch/langwatch/commit/ac7ea8b36ce903027fa5ea1970530f2420caec18))

## [0.3.0](https://github.com/langwatch/langwatch/compare/python-sdk@0.2.19...python-sdk@v0.3.0) (2025-09-18)


### Features

* bump it all from gpt-4o-mini to gpt-5 ([e2fb8bb](https://github.com/langwatch/langwatch/commit/e2fb8bb95048807b4a9d5713d41e6559e72da012))
* guaranteed availability python ([#633](https://github.com/langwatch/langwatch/issues/633)) ([1818542](https://github.com/langwatch/langwatch/commit/1818542bdacced509a66465c5641f33572fafe3c))


### Bug Fixes

* simplify truncation logic ([2e65ca2](https://github.com/langwatch/langwatch/commit/2e65ca2cf1dbcdf656791827f577fd5d1f44902a))
* span merging ([#615](https://github.com/langwatch/langwatch/issues/615)) ([e92eed0](https://github.com/langwatch/langwatch/commit/e92eed0d2fa146d4f7e53fb3ff8c416b3c7c5fa4))
* truncate and an utf-8 safer maner to ensure byte size limits ([3549421](https://github.com/langwatch/langwatch/commit/3549421c40c0e69de3fbdc33d45a372c8938d9fe))


### Code Refactoring

* improved type safety and SRP services ([#611](https://github.com/langwatch/langwatch/issues/611)) ([1270e4b](https://github.com/langwatch/langwatch/commit/1270e4b1ef3447d65d2d0fb9b5264a3d5a727547))
