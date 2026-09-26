# Changelog

## [0.5.0](https://github.com/langwatch/langwatch/compare/clickhouse-serverless@v0.4.0...clickhouse-serverless@v0.5.0) (2026-09-26)


### Features

* **lwql:** the app always owns the LangWatchQL access model — remove LWQL_SELF_PROVISION, delete the chart's rendered LWQL path, supersede ADR-101 ([#8258](https://github.com/langwatch/langwatch/issues/8258)) ([#8261](https://github.com/langwatch/langwatch/issues/8261)) ([a0e8401](https://github.com/langwatch/langwatch/commit/a0e8401f6aa2983178febc024f59af84cee4958d))

## [0.4.0](https://github.com/langwatch/langwatch/compare/clickhouse-serverless@v0.3.0...clickhouse-serverless@v0.4.0) (2026-09-12)


### Features

* **lwql:** ship the backend working by default on helm install/upgrade (self-provisioning) ([#7331](https://github.com/langwatch/langwatch/issues/7331)) ([b9aa200](https://github.com/langwatch/langwatch/commit/b9aa200aaa8bc4c458c510390522b830f54ddc31))

## [0.3.0](https://github.com/langwatch/langwatch/compare/clickhouse-serverless-0.2.0...clickhouse-serverless@v0.3.0) (2026-08-07)


### Features

* **charts:** alert when a ClickHouse backup stops succeeding ([#6436](https://github.com/langwatch/langwatch/issues/6436)) ([16c3dbc](https://github.com/langwatch/langwatch/commit/16c3dbc4a8a04b0ff79ba75e0544f05351d870bd))
* **charts:** consolidated chart hardening — admission control, ingress path blocking, component flags, signed OCI prereleases ([#6375](https://github.com/langwatch/langwatch/issues/6375)) ([4531d24](https://github.com/langwatch/langwatch/commit/4531d2434862c7c4cdd78b1dca5d46cb663430c0))


### Code Refactoring

* **build:** single pnpm workspace + restructure into sdks/ platform/ services/ mcp/ infra/ (ADR-076) ([#6405](https://github.com/langwatch/langwatch/issues/6405)) ([2bbeb7d](https://github.com/langwatch/langwatch/commit/2bbeb7dd2e0747e81478f22c3165adb9163c9f99))
