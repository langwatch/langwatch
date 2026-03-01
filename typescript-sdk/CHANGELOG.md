# Changelog

## [0.17.0](https://github.com/langwatch/langwatch/compare/typescript-sdk@v0.16.1...typescript-sdk@v0.17.0) (2026-03-01)


### Features

* **examples:** add metadata and labels examples for TypeScript and Python SDKs ([#1585](https://github.com/langwatch/langwatch/issues/1585)) ([7d09ab8](https://github.com/langwatch/langwatch/commit/7d09ab805146542921e8b1f1258d5e6e59462bfe))


### Bug Fixes

* get SDK e2e CI tests passing ([#1648](https://github.com/langwatch/langwatch/issues/1648)) ([2a4583e](https://github.com/langwatch/langwatch/commit/2a4583e4fb7ccb4674e64f0154f62fd990a2d8aa))
* typescript sdk uses correct attributes now sdk metadata ([#1651](https://github.com/langwatch/langwatch/issues/1651)) ([c499e26](https://github.com/langwatch/langwatch/commit/c499e26924a87cffe6abb37be8bdc739094a4568))
* **typescript-sdk:** improve auto-shutdown signals and default to batch processor ([#1851](https://github.com/langwatch/langwatch/issues/1851)) ([fcf6bb7](https://github.com/langwatch/langwatch/commit/fcf6bb751eaa895c874d3ed96b455966fd8d462a))


### Code Refactoring

* derive response_format from outputs, eliminate duality ([#1647](https://github.com/langwatch/langwatch/issues/1647)) ([856e4e7](https://github.com/langwatch/langwatch/commit/856e4e7350b26f25a44da919e4e7e7ffb5a0a0bd))
* derive response_format from outputs, eliminate stored duality ([856e4e7](https://github.com/langwatch/langwatch/commit/856e4e7350b26f25a44da919e4e7e7ffb5a0a0bd))

## [0.16.1](https://github.com/langwatch/langwatch/compare/typescript-sdk@v0.16.0...typescript-sdk@v0.16.1) (2026-02-16)


### Bug Fixes

* CLI sync now properly sends structured outputs to backend ([#1645](https://github.com/langwatch/langwatch/issues/1645)) ([9b57d7a](https://github.com/langwatch/langwatch/commit/9b57d7a9ffbc2d525261d3b509f12a1c01ccdda0))
* use local monorepo path for evaluators types in SDK publish ([#1643](https://github.com/langwatch/langwatch/issues/1643)) ([60412ce](https://github.com/langwatch/langwatch/commit/60412ce8668d9ff4ea507c21e4c8e79d47b6fe01))
* use local monorepo path for evaluators.generated.ts ([60412ce](https://github.com/langwatch/langwatch/commit/60412ce8668d9ff4ea507c21e4c8e79d47b6fe01))

## [0.16.0](https://github.com/langwatch/langwatch/compare/typescript-sdk@v0.15.0...typescript-sdk@v0.16.0) (2026-02-15)


### Features

* add POST /api/evaluators to create evaluators via REST API ([#1574](https://github.com/langwatch/langwatch/issues/1574)) ([3084655](https://github.com/langwatch/langwatch/commit/308465566db22345663ba78135338ad587e8d84d))
* full Liquid template support with autocomplete ([#1583](https://github.com/langwatch/langwatch/issues/1583)) ([00863a7](https://github.com/langwatch/langwatch/commit/00863a7643c8f6af48582bf82512fd37391902a7))


### Bug Fixes

* typescript sdk labels not configured correctly ([#1550](https://github.com/langwatch/langwatch/issues/1550)) ([13b07a4](https://github.com/langwatch/langwatch/commit/13b07a4b4d3abb281bdbfb49aadc367808a16391))


### Miscellaneous

* **deps-dev:** bump esbuild from 0.25.10 to 0.27.3 in /typescript-sdk ([#1469](https://github.com/langwatch/langwatch/issues/1469)) ([07561c4](https://github.com/langwatch/langwatch/commit/07561c49fe4ddbd054c9abac169c3ffa263a040e))
* **deps:** bump @opentelemetry/instrumentation from 0.205.0 to 0.211.0 in /typescript-sdk ([#1460](https://github.com/langwatch/langwatch/issues/1460)) ([4e1efe1](https://github.com/langwatch/langwatch/commit/4e1efe16405301666115a5a5d1f3fd246c05736f))
* **deps:** bump @opentelemetry/instrumentation in /typescript-sdk ([4e1efe1](https://github.com/langwatch/langwatch/commit/4e1efe16405301666115a5a5d1f3fd246c05736f))
* **deps:** bump @opentelemetry/resources from 2.1.0 to 2.5.0 in /typescript-sdk ([#1468](https://github.com/langwatch/langwatch/issues/1468)) ([e5530d3](https://github.com/langwatch/langwatch/commit/e5530d3902f4470f772123ec9fce502b2d3cdd43))
* **deps:** bump @opentelemetry/resources in /typescript-sdk ([e5530d3](https://github.com/langwatch/langwatch/commit/e5530d3902f4470f772123ec9fce502b2d3cdd43))
* **deps:** bump @opentelemetry/semantic-conventions from 1.37.0 to 1.39.0 in /typescript-sdk ([#1471](https://github.com/langwatch/langwatch/issues/1471)) ([1e04306](https://github.com/langwatch/langwatch/commit/1e0430631a63ef286cd1d0735082bb995ef5b80b))
* **deps:** bump @opentelemetry/semantic-conventions in /typescript-sdk ([1e04306](https://github.com/langwatch/langwatch/commit/1e0430631a63ef286cd1d0735082bb995ef5b80b))
* **deps:** bump dotenv from 16.6.1 to 17.2.4 in /typescript-sdk ([#1464](https://github.com/langwatch/langwatch/issues/1464)) ([4155d51](https://github.com/langwatch/langwatch/commit/4155d51cbf9b501f38571a96e29b21f825d8745b))
* **deps:** bump js-yaml from 4.1.0 to 4.1.1 in /typescript-sdk ([#1474](https://github.com/langwatch/langwatch/issues/1474)) ([72b4af2](https://github.com/langwatch/langwatch/commit/72b4af24bd78ebad4580fda6188e83bc9244d5e6))
* **deps:** bump open from 10.2.0 to 11.0.0 in /typescript-sdk ([#1472](https://github.com/langwatch/langwatch/issues/1472)) ([092b2e9](https://github.com/langwatch/langwatch/commit/092b2e91021700ca784230822f52e1beae07f221))
* **deps:** bump openapi-fetch from 0.14.0 to 0.16.0 in /typescript-sdk ([#1456](https://github.com/langwatch/langwatch/issues/1456)) ([99c04ef](https://github.com/langwatch/langwatch/commit/99c04ef67676c5f328f3055bbeaf41c7ec3b5031))
* **deps:** bump the npm_and_yarn group across 3 directories with 5 updates ([#1522](https://github.com/langwatch/langwatch/issues/1522)) ([fbb5dfd](https://github.com/langwatch/langwatch/commit/fbb5dfdc54ea42a80e24044ba2d5924c832ec5f1))
* **deps:** bump zod from 4.1.11 to 4.3.6 in /typescript-sdk ([#1450](https://github.com/langwatch/langwatch/issues/1450)) ([7e3e901](https://github.com/langwatch/langwatch/commit/7e3e90100f8da6b8a74e98acb1553a0c806c0466))

## [0.15.0](https://github.com/langwatch/langwatch/compare/typescript-sdk@v0.14.0...typescript-sdk@v0.15.0) (2026-02-12)


### Features

* **cli:** add separate prompt pull and prompt push commands ([#1543](https://github.com/langwatch/langwatch/issues/1543)) ([76c4881](https://github.com/langwatch/langwatch/commit/76c48817d284b300b33a37bbc52c4047bff8e36e))

## [0.14.0](https://github.com/langwatch/langwatch/compare/typescript-sdk@v0.13.0...typescript-sdk@v0.14.0) (2026-02-12)


### Features

* add public REST API for evaluators ([#1540](https://github.com/langwatch/langwatch/issues/1540)) ([46f4064](https://github.com/langwatch/langwatch/commit/46f4064c32dee33be58eee54f98c810a0da57cee))
* add public REST API for evaluators (/api/evaluators) ([46f4064](https://github.com/langwatch/langwatch/commit/46f4064c32dee33be58eee54f98c810a0da57cee))
* **evaluations-v3:** major table performance improvements, prompts to experiment button and other bugfixes ([#1181](https://github.com/langwatch/langwatch/issues/1181)) ([2cbf430](https://github.com/langwatch/langwatch/commit/2cbf4303f670edcd65a81f3af4d7a00a85b13010))


### Miscellaneous

* **deps:** bump liquidjs from 10.21.1 to 10.24.0 in /typescript-sdk ([#1466](https://github.com/langwatch/langwatch/issues/1466)) ([dd3ee8b](https://github.com/langwatch/langwatch/commit/dd3ee8b979b7659bbd346b06c7781e865880bd11))

## [0.13.0](https://github.com/langwatch/langwatch/compare/typescript-sdk@v0.12.0...typescript-sdk@v0.13.0) (2026-01-21)


### Features

* **llm-config:** upgrade model registry with dynamic parameters and OpenRouter sync ([#1115](https://github.com/langwatch/langwatch/issues/1115)) ([f03a283](https://github.com/langwatch/langwatch/commit/f03a283c1e49fa4127bbc82d01f301c6cc3fcf49))
* **sdk:** add online evaluations API and ensureSetup for TypeScript ([2209258](https://github.com/langwatch/langwatch/commit/22092580433b9a3014123e62f39cf8c44543d8cc))


### Miscellaneous

* add pnpm-workspace to typescript-sdk to avoid issues with nested pnpm installation ([671b025](https://github.com/langwatch/langwatch/commit/671b025e42402bbd5eda84c89fa4a3224d1ed235))


### Code Refactoring

* **sdk:** rename evaluation API to experiment for new terminology ([f10326c](https://github.com/langwatch/langwatch/commit/f10326c0f2ee5818fbcf51507a95933bfe83caeb))
* **sdk:** rename internal evaluation classes to experiment ([ff70cab](https://github.com/langwatch/langwatch/commit/ff70cab904905b85a77a68e7b1eb60e9c364a18d))

## [0.12.0](https://github.com/langwatch/langwatch/compare/typescript-sdk@v0.11.0...typescript-sdk@v0.12.0) (2026-01-18)


### Features

* add CI/CD execution support for evaluations v3 ([#1118](https://github.com/langwatch/langwatch/issues/1118)) ([d28adac](https://github.com/langwatch/langwatch/commit/d28adaceeb87921d9c7c0f1cf76b5e03f3b90fbd))


### Bug Fixes

* various evaluations v3 fixes ([#1122](https://github.com/langwatch/langwatch/issues/1122)) ([c9904fc](https://github.com/langwatch/langwatch/commit/c9904fc898a7982ec0b23b11fcfeed83f34fbeb7))

## [0.11.0](https://github.com/langwatch/langwatch/compare/typescript-sdk@v0.10.0...typescript-sdk@v0.11.0) (2026-01-16)


### Features

* evaluations v3 execution and new evaluations results page ([#1113](https://github.com/langwatch/langwatch/issues/1113)) ([510f65d](https://github.com/langwatch/langwatch/commit/510f65d17e13c539b877e7eed2fefff118ceb705))


### Bug Fixes

* remove localhost:5560 fallback from integration tests ([6a8909f](https://github.com/langwatch/langwatch/commit/6a8909f4418e3ea99bfd704032918e550752b73e))
* resolve all eslint warnings and errors ([670d623](https://github.com/langwatch/langwatch/commit/670d623061cec1e966982de90bf18bb863853f55))
* respect prompt version when fetching prompts via CLI ([#1075](https://github.com/langwatch/langwatch/issues/1075)) ([4daa0b0](https://github.com/langwatch/langwatch/commit/4daa0b0ac4cadf6c1a5999244bbfaba6513598d1))


### Miscellaneous

* trigger release ([#1011](https://github.com/langwatch/langwatch/issues/1011)) ([6173f53](https://github.com/langwatch/langwatch/commit/6173f53b041d9ee7e6b930270224954ba3c6621e))

## [0.10.0](https://github.com/langwatch/langwatch/compare/typescript-sdk@v0.9.0...typescript-sdk@v0.10.0) (2025-12-15)


### Features

* implement FetchPolicy for prompt retrieval ([#968](https://github.com/langwatch/langwatch/issues/968)) ([4530d6d](https://github.com/langwatch/langwatch/commit/4530d6d8135b70c07731a4d9ae454c4b19b7ce13))
* migrate from npm to pnpm ([#940](https://github.com/langwatch/langwatch/issues/940)) ([ce52474](https://github.com/langwatch/langwatch/commit/ce52474c3023ccb4714e4a33373d3c644f1496bf))

## [0.9.0](https://github.com/langwatch/langwatch/compare/typescript-sdk@v0.8.2...typescript-sdk@v0.9.0) (2025-12-03)


### Features

* **cli:** add --version command ([#904](https://github.com/langwatch/langwatch/issues/904)) ([e9908a3](https://github.com/langwatch/langwatch/commit/e9908a3808f86869b5011e5ac0f0e11a5a7c2b7b))


### Bug Fixes

* **typescript-sdk:** preserve object data in createSafeFallbackValue … ([#907](https://github.com/langwatch/langwatch/issues/907)) ([754525a](https://github.com/langwatch/langwatch/commit/754525af925056c2974dcd35b5d03118c32da7c6))

## [0.8.2](https://github.com/langwatch/langwatch/compare/typescript-sdk@v0.8.1...typescript-sdk@v0.8.2) (2025-11-28)


### Bug Fixes

* **prompts:** make prompts.get throw error instead of returning null/undefined ([#867](https://github.com/langwatch/langwatch/issues/867)) ([9705201](https://github.com/langwatch/langwatch/commit/97052015061f40fc63069c78bb1e702cbf12fa29))

## [0.8.1](https://github.com/langwatch/langwatch/compare/typescript-sdk@v0.8.0...typescript-sdk@v0.8.1) (2025-11-15)


### Bug Fixes

* stop asking for gitignore so it doesn't stop llms from using the cli ([ecdfc6d](https://github.com/langwatch/langwatch/commit/ecdfc6d3b22a6a5a5927842855e1af71ee87c1b4))

## [0.8.0](https://github.com/langwatch/langwatch/compare/typescript-sdk@v0.7.4...typescript-sdk@v0.8.0) (2025-10-31)


### Features

* exporter filter span logic ([#733](https://github.com/langwatch/langwatch/issues/733)) ([0db9b16](https://github.com/langwatch/langwatch/commit/0db9b1629a3a362f37113aaf26a5543b8dee2ead))


### Bug Fixes

* error handling ([#747](https://github.com/langwatch/langwatch/issues/747)) ([732a7ef](https://github.com/langwatch/langwatch/commit/732a7ef0520b58ef44ec716831110d5f61d8edd7))
* find local prompt ([#700](https://github.com/langwatch/langwatch/issues/700)) ([ab42400](https://github.com/langwatch/langwatch/commit/ab42400dea353dd72f5be66004f0cb9a11f2e7d2))
* integration tests for typescript sdk ([#757](https://github.com/langwatch/langwatch/issues/757)) ([bfd79bb](https://github.com/langwatch/langwatch/commit/bfd79bbdbcb00668720709bf53789aceb79b0466))
* **next.js-15:** Register NodeTracerProvider globally when ProxyTracerProvider detected ([87c1f1f](https://github.com/langwatch/langwatch/commit/87c1f1fd890b89c64ecf39997d5236dc506dd3cf))
* readme was from an early draft of the typescript sdk ([#662](https://github.com/langwatch/langwatch/issues/662)) ([5a2b115](https://github.com/langwatch/langwatch/commit/5a2b1151a0cd286390561c274a53b30ad73bad91))
* register NodeTracerProvider globally when ProxyTracerProvider detected ([#754](https://github.com/langwatch/langwatch/issues/754)) ([87c1f1f](https://github.com/langwatch/langwatch/commit/87c1f1fd890b89c64ecf39997d5236dc506dd3cf))
* typescript sdk loicense badge to be mit and use correct logo path ([#660](https://github.com/langwatch/langwatch/issues/660)) ([688429d](https://github.com/langwatch/langwatch/commit/688429dc574167631091842690cd2c43867dd5da))


### Miscellaneous

* bump typescript sdk to v0.7.4 ([#755](https://github.com/langwatch/langwatch/issues/755)) ([697792c](https://github.com/langwatch/langwatch/commit/697792cc9242e31c091adbf18c37aca305b9a21d))
* improve typescript sdk dependencies to play nicer with other children ([#659](https://github.com/langwatch/langwatch/issues/659)) ([da3daa9](https://github.com/langwatch/langwatch/commit/da3daa9a8013b1eb568ee256b33227fe57f9dafe))
* release main ([#655](https://github.com/langwatch/langwatch/issues/655)) ([6d7edc9](https://github.com/langwatch/langwatch/commit/6d7edc9e9e0a74f7e6a728320845edb56b45febe))
* release main ([#661](https://github.com/langwatch/langwatch/issues/661)) ([73f524f](https://github.com/langwatch/langwatch/commit/73f524f794a5e1cea46eb09ed492ad3351a7161f))
* release main ([#706](https://github.com/langwatch/langwatch/issues/706)) ([61f8027](https://github.com/langwatch/langwatch/commit/61f802722837c2a3a6ad1864f6b3625b1b111d7a))
* release main ([#746](https://github.com/langwatch/langwatch/issues/746)) ([1108004](https://github.com/langwatch/langwatch/commit/110800424ab2197595348759d1cceba0451bd31a))

## [0.7.4](https://github.com/langwatch/langwatch/compare/typescript-sdk@v0.7.3...typescript-sdk@v0.7.4) (2025-10-31)


### Bug Fixes

* error handling ([#747](https://github.com/langwatch/langwatch/issues/747)) ([732a7ef](https://github.com/langwatch/langwatch/commit/732a7ef0520b58ef44ec716831110d5f61d8edd7))
* integration tests for typescript sdk ([#757](https://github.com/langwatch/langwatch/issues/757)) ([bfd79bb](https://github.com/langwatch/langwatch/commit/bfd79bbdbcb00668720709bf53789aceb79b0466))
* **next.js-15:** Register NodeTracerProvider globally when ProxyTracerProvider detected ([87c1f1f](https://github.com/langwatch/langwatch/commit/87c1f1fd890b89c64ecf39997d5236dc506dd3cf))
* register NodeTracerProvider globally when ProxyTracerProvider detected ([#754](https://github.com/langwatch/langwatch/issues/754)) ([87c1f1f](https://github.com/langwatch/langwatch/commit/87c1f1fd890b89c64ecf39997d5236dc506dd3cf))


### Miscellaneous

* bump typescript sdk to v0.7.4 ([#755](https://github.com/langwatch/langwatch/issues/755)) ([697792c](https://github.com/langwatch/langwatch/commit/697792cc9242e31c091adbf18c37aca305b9a21d))

## [0.7.3](https://github.com/langwatch/langwatch/compare/typescript-sdk@v0.7.2...typescript-sdk@v0.7.3) (2025-10-13)


### Bug Fixes

* find local prompt ([#700](https://github.com/langwatch/langwatch/issues/700)) ([ab42400](https://github.com/langwatch/langwatch/commit/ab42400dea353dd72f5be66004f0cb9a11f2e7d2))

## [0.7.2](https://github.com/langwatch/langwatch/compare/typescript-sdk@v0.7.1...typescript-sdk@v0.7.2) (2025-10-02)


### Bug Fixes

* readme was from an early draft of the typescript sdk ([#662](https://github.com/langwatch/langwatch/issues/662)) ([5a2b115](https://github.com/langwatch/langwatch/commit/5a2b1151a0cd286390561c274a53b30ad73bad91))
* typescript sdk loicense badge to be mit and use correct logo path ([#660](https://github.com/langwatch/langwatch/issues/660)) ([688429d](https://github.com/langwatch/langwatch/commit/688429dc574167631091842690cd2c43867dd5da))

## [0.7.1](https://github.com/langwatch/langwatch/compare/typescript-sdk@v0.7.0...typescript-sdk@v0.7.1) (2025-09-22)


### Miscellaneous

* improve typescript sdk dependencies to play nicer with other children ([#659](https://github.com/langwatch/langwatch/issues/659)) ([da3daa9](https://github.com/langwatch/langwatch/commit/da3daa9a8013b1eb568ee256b33227fe57f9dafe))

## [0.7.0](https://github.com/langwatch/langwatch/compare/typescript-sdk@v0.6.0...typescript-sdk@v0.7.0) (2025-09-19)


### Features

* improve helm chart ([#608](https://github.com/langwatch/langwatch/issues/608)) ([699b8f0](https://github.com/langwatch/langwatch/commit/699b8f0a9ce3b05058141f00281a5b68f9874978))

## [0.6.0](https://github.com/langwatch/langwatch/compare/typescript-sdk@v0.5.1...typescript-sdk@v0.6.0) (2025-09-18)


### Features

* guaranteed availability ([#630](https://github.com/langwatch/langwatch/issues/630)) ([d4d3f55](https://github.com/langwatch/langwatch/commit/d4d3f553daaeaba1d3576141f40fc182ef2b21bf))

## [0.5.1](https://github.com/langwatch/langwatch/compare/typescript-sdk@0.5.0...typescript-sdk@v0.5.1) (2025-09-11)


### Miscellaneous

* add release please ([#624](https://github.com/langwatch/langwatch/issues/624)) ([e46cd21](https://github.com/langwatch/langwatch/commit/e46cd210e09c5dde95f030c3f92014f882272944))
