# Changelog

## [0.3.0](https://github.com/langwatch/langwatch/compare/clickhouse-serverless-0.2.0...clickhouse-serverless@v0.3.0) (2026-07-01)


### Features

* **charts:** harden pods for strict admission policies ([55ced05](https://github.com/langwatch/langwatch/commit/55ced0523c50970947467356ae81bd123ff85d74))
* **charts:** harden pods for strict admission policies (seccomp, automount, resources) ([#4927](https://github.com/langwatch/langwatch/issues/4927)) ([55ced05](https://github.com/langwatch/langwatch/commit/55ced0523c50970947467356ae81bd123ff85d74))


### Bug Fixes

* **chart:** gate clickhouse Secrets on autogen.enabled (Argo drift, subchart + parent) ([#4447](https://github.com/langwatch/langwatch/issues/4447)) ([e364851](https://github.com/langwatch/langwatch/commit/e3648513eac161870c652968edec8d7aae21ef20))
