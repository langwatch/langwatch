# Changelog

## [0.5.0](https://github.com/langwatch/langwatch/compare/clickhouse-serverless@v0.4.0...clickhouse-serverless@v0.5.0) (2026-11-14)


### Bug Fixes

* **clickhouse-serverless:** build on 26.8.36.3 and find backups in renamed backup_log copies ([#9490](https://github.com/langwatch/langwatch/issues/9490)) ([e41fb25](https://github.com/langwatch/langwatch/commit/e41fb2517f607ebca3fa00188ade958df8912717))
* **helm:** bump chart images for CVE fixes (postgres, redis, curl, prometheus, alpine/k8s) ([#9208](https://github.com/langwatch/langwatch/issues/9208)) ([ad7c623](https://github.com/langwatch/langwatch/commit/ad7c623567ba6fa783fa317e353da28941dc6f5d))

## [0.4.0](https://github.com/langwatch/langwatch/compare/clickhouse-serverless@v0.3.0...clickhouse-serverless@v0.4.0) (2026-09-12)


### Features

* **lwql:** ship the backend working by default on helm install/upgrade (self-provisioning) ([#7331](https://github.com/langwatch/langwatch/issues/7331)) ([b9aa200](https://github.com/langwatch/langwatch/commit/b9aa200aaa8bc4c458c510390522b830f54ddc31))

## [0.3.0](https://github.com/langwatch/langwatch/compare/clickhouse-serverless-0.2.0...clickhouse-serverless@v0.3.0) (2026-08-07)

### Features

- **charts:** alert when a ClickHouse backup stops succeeding ([#6436](https://github.com/langwatch/langwatch/issues/6436)) ([16c3dbc](https://github.com/langwatch/langwatch/commit/16c3dbc4a8a04b0ff79ba75e0544f05351d870bd))
- **charts:** consolidated chart hardening — admission control, ingress path blocking, component flags, signed OCI prereleases ([#6375](https://github.com/langwatch/langwatch/issues/6375)) ([4531d24](https://github.com/langwatch/langwatch/commit/4531d2434862c7c4cdd78b1dca5d46cb663430c0))

### Code Refactoring

- **build:** single pnpm workspace + restructure into sdks/ platform/ services/ mcp/ infra/ (ADR-076) ([#6405](https://github.com/langwatch/langwatch/issues/6405)) ([2bbeb7d](https://github.com/langwatch/langwatch/commit/2bbeb7dd2e0747e81478f22c3165adb9163c9f99))
