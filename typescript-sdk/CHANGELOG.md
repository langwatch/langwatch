# Changelog

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
