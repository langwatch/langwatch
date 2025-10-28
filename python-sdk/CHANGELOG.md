# Changelog

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
