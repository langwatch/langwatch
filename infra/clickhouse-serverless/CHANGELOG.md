# Changelog

## [0.5.0](https://github.com/langwatch/langwatch/compare/clickhouse-serverless-image@v0.4.0...clickhouse-serverless-image@v0.5.0) (2026-09-26)


### Features

* **instant-evals:** the Instant Eval run, a judgment job over an LWQL statement with progress and persisted judgments ([#8208](https://github.com/langwatch/langwatch/issues/8208)) ([e337419](https://github.com/langwatch/langwatch/commit/e33741926479c94f6d0b6d2b80d76e886dc1e109))
* **lwql:** app-side extraction functions as identity UDFs with a hydration stage ([#8196](https://github.com/langwatch/langwatch/issues/8196)) ([ad1bc9e](https://github.com/langwatch/langwatch/commit/ad1bc9eddf8f1c30e79b213cbd7fdbcb4563f990))
* **lwql:** derive every tenant-scoped Postgres model into the catalog by default ([#8209](https://github.com/langwatch/langwatch/issues/8209)) ([ea93080](https://github.com/langwatch/langwatch/commit/ea93080f4db38c70406b7737344b7132f3b931e9))
* **lwql:** the app always owns the LangWatchQL access model — remove LWQL_SELF_PROVISION, delete the chart's rendered LWQL path, supersede ADR-101 ([#8258](https://github.com/langwatch/langwatch/issues/8258)) ([#8261](https://github.com/langwatch/langwatch/issues/8261)) ([a0e8401](https://github.com/langwatch/langwatch/commit/a0e8401f6aa2983178febc024f59af84cee4958d))
* **query:** self-describing LangWatchQL door + whoami --json ([#8085](https://github.com/langwatch/langwatch/issues/8085)) ([#8113](https://github.com/langwatch/langwatch/issues/8113)) ([5b17bde](https://github.com/langwatch/langwatch/commit/5b17bde8e2497714d489504d13d8306393be429c))
* webinar learnings, connected agent scope, scenario names, search hints, deep links, judge and Langy fixes ([#8236](https://github.com/langwatch/langwatch/issues/8236)) ([2054720](https://github.com/langwatch/langwatch/commit/2054720f391a2fcec60b86870a98d87345ccf6ee))

## [0.4.0](https://github.com/langwatch/langwatch/compare/clickhouse-serverless-image@v0.3.0...clickhouse-serverless-image@v0.4.0) (2026-09-12)


### Features

* **lwql:** ship the backend working by default on helm install/upgrade (self-provisioning) ([#7331](https://github.com/langwatch/langwatch/issues/7331)) ([b9aa200](https://github.com/langwatch/langwatch/commit/b9aa200aaa8bc4c458c510390522b830f54ddc31))


### Bug Fixes

* **release:** infra/clickhouse-serverless changes now cut a release ([#7393](https://github.com/langwatch/langwatch/issues/7393)) ([df41888](https://github.com/langwatch/langwatch/commit/df41888e0a2861eb93d886b1798cb9ad2b81e7b9))

## [0.2.0](https://github.com/langwatch/langwatch/compare/clickhouse-serverless@v0.1.0...clickhouse-serverless@v0.2.0) (2026-04-08)


### Features

* serverless clickhouse with auto-tuning and optimisations for a langwatch install + helm chart  ([#2949](https://github.com/langwatch/langwatch/issues/2949)) ([ddb722b](https://github.com/langwatch/langwatch/commit/ddb722b120c70af1747842187936f14b8895d5ca))
