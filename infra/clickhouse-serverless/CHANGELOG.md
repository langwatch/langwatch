# Changelog

## [0.5.0](https://github.com/langwatch/langwatch/compare/clickhouse-serverless-image@v0.4.0...clickhouse-serverless-image@v0.5.0) (2026-11-14)


### Features

* **clickhouse-serverless:** per-user caps in access.yaml ([#9533](https://github.com/langwatch/langwatch/issues/9533)) ([1959838](https://github.com/langwatch/langwatch/commit/1959838a062d0ae0dd2f9c48fe67bfa135c74a68))


### Bug Fixes

* **clickhouse-serverless:** bound memory on pods of 4 GiB or less ([#8856](https://github.com/langwatch/langwatch/issues/8856)) ([495155c](https://github.com/langwatch/langwatch/commit/495155cf746d207717411cf67cd46c4a6407eaec))
* **clickhouse-serverless:** build on 26.8.36.3 and find backups in renamed backup_log copies ([#9490](https://github.com/langwatch/langwatch/issues/9490)) ([e41fb25](https://github.com/langwatch/langwatch/commit/e41fb2517f607ebca3fa00188ade958df8912717))
* **clickhouse-serverless:** elect the backup runner when system.clusters repeats a replica ([#9530](https://github.com/langwatch/langwatch/issues/9530)) ([b26728c](https://github.com/langwatch/langwatch/commit/b26728c7c31762a6834977a7e05b6b1ca8f9c011))
* **go:** bump the toolchain to go1.27.3 for GO-2026-6809 ([#8905](https://github.com/langwatch/langwatch/issues/8905)) ([5d58b64](https://github.com/langwatch/langwatch/commit/5d58b64194dde3a1ee1cfe2f746616c08d5eb903))
* **governance:** centre the overview again and empty its lists with the design system's line ([#8932](https://github.com/langwatch/langwatch/issues/8932)) ([685c8e7](https://github.com/langwatch/langwatch/commit/685c8e729cb0f443bf44a49f9821f4285eb8c626))
* **security:** pin Node to 24.22.1 for the October 2026 security releases ([#8933](https://github.com/langwatch/langwatch/issues/8933)) ([84b8925](https://github.com/langwatch/langwatch/commit/84b892544207ee63f7ed04e890820fb08f04a6d8))


### Miscellaneous

* **go:** bump the toolchain to go1.27.4 for GO-2026-6859 ([#9493](https://github.com/langwatch/langwatch/issues/9493)) ([7f72e80](https://github.com/langwatch/langwatch/commit/7f72e809899adbdaa0505def37978591573f08a6))

## [0.4.0](https://github.com/langwatch/langwatch/compare/clickhouse-serverless-image@v0.3.0...clickhouse-serverless-image@v0.4.0) (2026-09-12)


### Features

* **lwql:** ship the backend working by default on helm install/upgrade (self-provisioning) ([#7331](https://github.com/langwatch/langwatch/issues/7331)) ([b9aa200](https://github.com/langwatch/langwatch/commit/b9aa200aaa8bc4c458c510390522b830f54ddc31))


### Bug Fixes

* **release:** infra/clickhouse-serverless changes now cut a release ([#7393](https://github.com/langwatch/langwatch/issues/7393)) ([df41888](https://github.com/langwatch/langwatch/commit/df41888e0a2861eb93d886b1798cb9ad2b81e7b9))

## [0.2.0](https://github.com/langwatch/langwatch/compare/clickhouse-serverless@v0.1.0...clickhouse-serverless@v0.2.0) (2026-04-08)

### Features

- serverless clickhouse with auto-tuning and optimisations for a langwatch install + helm chart ([#2949](https://github.com/langwatch/langwatch/issues/2949)) ([ddb722b](https://github.com/langwatch/langwatch/commit/ddb722b120c70af1747842187936f14b8895d5ca))
