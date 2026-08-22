# Changelog

## [3.1.0](https://github.com/langwatch/langwatch/compare/langevals@v3.0.0...langevals@v3.1.0) (2026-08-22)


### Features

* **langevals:** run same-credential evaluations concurrently ([#7190](https://github.com/langwatch/langwatch/issues/7190)) ([3b5e26a](https://github.com/langwatch/langwatch/commit/3b5e26a9916db0efa6d79b30db0fdef7033c06b5))
* **sdk:** judge n-way target comparisons from the experiment SDKs ([#6863](https://github.com/langwatch/langwatch/issues/6863)) ([9c34d3c](https://github.com/langwatch/langwatch/commit/9c34d3c37418ecf6d29b0e521d66fca0661a45d8))


### Bug Fixes

* **ci:** re-arm a dead ast-grep rule and repoint stale post-restructure paths ([#6892](https://github.com/langwatch/langwatch/issues/6892)) ([4a88619](https://github.com/langwatch/langwatch/commit/4a88619d46f30f14212d8e366c83855030249db4))
* **experiments:** let a row the judge could not settle explain itself ([#6928](https://github.com/langwatch/langwatch/issues/6928)) ([853b1a1](https://github.com/langwatch/langwatch/commit/853b1a1343adce6edcf84c8a3d7e418f3594701a))
* **langevals:** keep the server responsive under load and size workers by the real CPU limit ([#7133](https://github.com/langwatch/langwatch/issues/7133)) ([083440d](https://github.com/langwatch/langwatch/commit/083440d963a529412bbbf39a934d1409f8b1fa70))
* **langevals:** stop self-hosted evaluators crashing on dspy thread-affinity and retry-storming 400s ([#7129](https://github.com/langwatch/langwatch/issues/7129)) ([ae45dc5](https://github.com/langwatch/langwatch/commit/ae45dc5752b3f4b679f5789246fed362c2cdaa4d))


### Miscellaneous

* **deps-dev:** bump pandas from 2.3.3 to 3.0.5 in /services/langevals ([#7252](https://github.com/langwatch/langwatch/issues/7252)) ([1f7aba9](https://github.com/langwatch/langwatch/commit/1f7aba9b37bf9804951e9975023e20aec308e7c8))
* **deps:** bump arize-phoenix ([df74857](https://github.com/langwatch/langwatch/commit/df74857b57c53c959164917640791e240a38afab))
* **deps:** bump arize-phoenix from 14.6.0 to 20.0.0 in /services/langevals in the arize group across 1 directory ([#7289](https://github.com/langwatch/langwatch/issues/7289)) ([df74857](https://github.com/langwatch/langwatch/commit/df74857b57c53c959164917640791e240a38afab))
* **deps:** bump boto3 ([bc87542](https://github.com/langwatch/langwatch/commit/bc87542fac41b544665f4976a174955e189f65bf))
* **deps:** bump boto3 from 1.43.68 to 1.43.69 in /services/langevals in the minor-and-patch group across 1 directory ([#7293](https://github.com/langwatch/langwatch/issues/7293)) ([bc87542](https://github.com/langwatch/langwatch/commit/bc87542fac41b544665f4976a174955e189f65bf))
* **deps:** bump gunicorn from 25.0.1 to 26.0.0 in /services/langevals ([#7256](https://github.com/langwatch/langwatch/issues/7256)) ([b5c1746](https://github.com/langwatch/langwatch/commit/b5c1746e2055bcbf3afe6e3a8713da8fcec7964d))
* **deps:** bump structlog from 25.5.0 to 26.1.0 in /services/langevals ([#7255](https://github.com/langwatch/langwatch/issues/7255)) ([c53a68a](https://github.com/langwatch/langwatch/commit/c53a68a3eac3bc40a29a30c1d4368dc454b3b649))
* **deps:** bump tenacity from 8.5.0 to 9.1.4 in /services/langevals ([#7254](https://github.com/langwatch/langwatch/issues/7254)) ([883c0d2](https://github.com/langwatch/langwatch/commit/883c0d218573534fcad830b867a1b94660e12ecb))
* **deps:** bump the minor-and-patch group ([b81bc60](https://github.com/langwatch/langwatch/commit/b81bc60bb93d374ff6b4fa2cca544532aeaeca13))
* **deps:** bump the minor-and-patch group in /services/langevals with 23 updates ([#7251](https://github.com/langwatch/langwatch/issues/7251)) ([b81bc60](https://github.com/langwatch/langwatch/commit/b81bc60bb93d374ff6b4fa2cca544532aeaeca13))
* **deps:** bump zipp from 3.23.0 to 4.1.0 in /services/langevals ([#7257](https://github.com/langwatch/langwatch/issues/7257)) ([4be2c51](https://github.com/langwatch/langwatch/commit/4be2c5189187052c4d654de3e0cc1c1e51cb7181))
* **security:** clear the dependabot alert backlog (278 open alerts triaged) ([#7195](https://github.com/langwatch/langwatch/issues/7195)) ([e5e64aa](https://github.com/langwatch/langwatch/commit/e5e64aa692c519eeebd5dc2e6b36c4263ec2191d))

## [3.0.0](https://github.com/langwatch/langwatch/compare/langevals@v2.2.0...langevals@v3.0.0) (2026-08-08)


### ⚠ BREAKING CHANGES

* **evaluators:** evaluations, monitors and experiments referencing a legacy/ragas_* evaluator type stop working. Their current equivalents in the ragas/* family remain available.

### Features

* **evaluators:** remove the legacy Ragas evaluators ([#6600](https://github.com/langwatch/langwatch/issues/6600)) ([ef9ea90](https://github.com/langwatch/langwatch/commit/ef9ea90e22bc2adb92bacf5c732cc996c9782bfe))
