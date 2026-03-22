# Changelog

## [2.3.0](https://github.com/langwatch/langwatch/compare/langevals@v2.2.0...langevals@v2.3.0) (2026-03-22)


### Features

* move langevals into monorepo ([#1591](https://github.com/langwatch/langwatch/issues/1591)) ([0d8a7ed](https://github.com/langwatch/langwatch/commit/0d8a7ed1278f7218e9a1749b247566853b1a3268))
* register sentiment evaluator and enforce exhaustive category mapping ([#2321](https://github.com/langwatch/langwatch/issues/2321)) ([0f43f39](https://github.com/langwatch/langwatch/commit/0f43f397a9d7364b7fd44bc6ee6e3608182db730))
* studio evaluator sidebar, inline editing, agent/HTTP nodes, llm-as-a-judge image support and image rendering on experiments workbench ([#1589](https://github.com/langwatch/langwatch/issues/1589)) ([3da4f98](https://github.com/langwatch/langwatch/commit/3da4f982d532cac9fbb576f2b56a2ded5f726a55))


### Bug Fixes

* truncate long inputs in sentiment evaluator instead of skipping ([#2333](https://github.com/langwatch/langwatch/issues/2333)) ([ef8aba7](https://github.com/langwatch/langwatch/commit/ef8aba7af36b7e1d51f4eeff184f15daec5fd6d2))


### Miscellaneous

* **deps:** bump Python (uv) dependencies across langwatch_nlp, python-sdk, langevals ([#1940](https://github.com/langwatch/langwatch/issues/1940)) ([d103f89](https://github.com/langwatch/langwatch/commit/d103f89fc1936dc8dae73f2b90885a28b97e2775))
* **deps:** bump Python uv lockfile packages (v2) ([#1954](https://github.com/langwatch/langwatch/issues/1954)) ([23b3a5c](https://github.com/langwatch/langwatch/commit/23b3a5ce9f16d6a722690cbdd86cb095f01dba08))
* switch default evaluator model from gpt-5 to gpt-5-mini ([#2340](https://github.com/langwatch/langwatch/issues/2340)) ([5749849](https://github.com/langwatch/langwatch/commit/57498498a9e8dd578ba72c97b1a97ed1bbb2f376))


### Code Refactoring

* migrate satisfaction score to sentiment evaluator in langevals ([#2207](https://github.com/langwatch/langwatch/issues/2207)) ([7eef52a](https://github.com/langwatch/langwatch/commit/7eef52aa92bd9205e3e18c470487ca3174fe9d13))
