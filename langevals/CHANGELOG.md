# Changelog

## [2.3.0](https://github.com/langwatch/langwatch/compare/langevals@v2.2.0...langevals@v2.3.0) (2026-07-01)


### Features

* **experiments-v3:** pairwise compare end-to-end with winner-by-id label ([#5142](https://github.com/langwatch/langwatch/issues/5142)) ([5964a2f](https://github.com/langwatch/langwatch/commit/5964a2f02f9175dd4d64125786f97556fdb0b116))
* **langevals:** stage large payloads to S3 via presigned URL ([#4189](https://github.com/langwatch/langwatch/issues/4189)) ([7e994ce](https://github.com/langwatch/langwatch/commit/7e994ce9e5481e0f32dbe2b6038d1db93b19d66c))


### Bug Fixes

* **deps:** close 6 langevals security alerts with minimal stable bumps ([1467908](https://github.com/langwatch/langwatch/commit/14679085c750c94f7b583ca7479b4e76cc58ff23))
* **deps:** close 6 langevals security alerts with minimal stable bumps (no prerelease, no downgrade) ([#4654](https://github.com/langwatch/langwatch/issues/4654)) ([1467908](https://github.com/langwatch/langwatch/commit/14679085c750c94f7b583ca7479b4e76cc58ff23))
* **deps:** close langevals transformers and strawberry-graphql security alerts ([#4656](https://github.com/langwatch/langwatch/issues/4656)) ([50b3250](https://github.com/langwatch/langwatch/commit/50b32501a58165a75286024e1901c3f22862151c))
* **deps:** upgrade langsmith sdk security floors ([2e18927](https://github.com/langwatch/langwatch/commit/2e18927c0c1c1fdec24c2bba17e5f094e56a9deb))
* **deps:** upgrade LangSmith SDK security floors ([#4041](https://github.com/langwatch/langwatch/issues/4041)) ([2e18927](https://github.com/langwatch/langwatch/commit/2e18927c0c1c1fdec24c2bba17e5f094e56a9deb))
* **deps:** uv security sweep across langevals, mcp-server, python-sdk ([#4687](https://github.com/langwatch/langwatch/issues/4687)) ([7eba1fb](https://github.com/langwatch/langwatch/commit/7eba1fbec1cf01b7929b35529c41f5b089070263))
* **evals-v3:** coerce non-string evaluator inputs + lock auto-mapping ([#4642](https://github.com/langwatch/langwatch/issues/4642)) ([914dbd4](https://github.com/langwatch/langwatch/commit/914dbd4109e8f97e178fe2c112ff62b27b9cd0e7))
* **ragas:** migrate Faithfulness _create_statements patch to ragas&gt;=0.3 API ([#4113](https://github.com/langwatch/langwatch/issues/4113)) ([deadb2b](https://github.com/langwatch/langwatch/commit/deadb2b59e3fba5ed9117a2b8e0061f7b1d5ffad))
* **security:** bump hono&gt;=4.12.25 and langsmith&gt;=0.8.18 ([5dd4178](https://github.com/langwatch/langwatch/commit/5dd41782beee86ce4333c255d0914357a4e9716d))
* **security:** bump hono&gt;=4.12.25 and langsmith&gt;=0.8.18 (Dependabot [#1500](https://github.com/langwatch/langwatch/issues/1500), [#1516](https://github.com/langwatch/langwatch/issues/1516)) ([#5211](https://github.com/langwatch/langwatch/issues/5211)) ([5dd4178](https://github.com/langwatch/langwatch/commit/5dd41782beee86ce4333c255d0914357a4e9716d))
* **security:** bump Python infra deps (cryptography, tornado, python-multipart, aiohttp) ([#4873](https://github.com/langwatch/langwatch/issues/4873)) ([7488bc5](https://github.com/langwatch/langwatch/commit/7488bc5a088ce12c2de13f1a2472afc1b9bdb6a4))
* **security:** bump starlette to 1.3.1 across uv workspaces ([#5019](https://github.com/langwatch/langwatch/issues/5019)) ([dc03945](https://github.com/langwatch/langwatch/commit/dc0394579b59f2f4a81da283f34a6478a501b1b0))


### Miscellaneous

* **security:** add dependency age gates ([#3523](https://github.com/langwatch/langwatch/issues/3523)) ([78f5b20](https://github.com/langwatch/langwatch/commit/78f5b2059228748d19fb4bf74118c9bee6c474f9))


### Code Refactoring

* **types:** make zod the single source of truth, remove ts-to-zod ([#4651](https://github.com/langwatch/langwatch/issues/4651)) ([d583fbe](https://github.com/langwatch/langwatch/commit/d583fbe2ed2ca2ef320695323c17f6c362ea4efa))
