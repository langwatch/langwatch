# Changelog

## [2.3.0](https://github.com/langwatch/langwatch/compare/langevals@v2.2.0...langevals@v2.3.0) (2026-07-24)


### Features

* **evaluators:** one "Comparison" judge for two or more candidates ([#5100](https://github.com/langwatch/langwatch/issues/5100), [#5101](https://github.com/langwatch/langwatch/issues/5101)) ([#5528](https://github.com/langwatch/langwatch/issues/5528)) ([37ab6d1](https://github.com/langwatch/langwatch/commit/37ab6d1072e333d289e17dfb1a2cc333159ae881))
* **experiments-v3:** pairwise compare end-to-end with winner-by-id label ([#5142](https://github.com/langwatch/langwatch/issues/5142)) ([5964a2f](https://github.com/langwatch/langwatch/commit/5964a2f02f9175dd4d64125786f97556fdb0b116))
* **pairwise-compare:** support comparing A vs B without a golden/reference answer ([#5381](https://github.com/langwatch/langwatch/issues/5381)) ([8d58404](https://github.com/langwatch/langwatch/commit/8d584040e34d402df23a2fe391f20a2e79662b41))


### Bug Fixes

* comparison judge error handling ([#5789](https://github.com/langwatch/langwatch/issues/5789)) ([a04a5cb](https://github.com/langwatch/langwatch/commit/a04a5cbcdddebcd161f46c7e55f7223009a3dd84))
* **security:** bump hono&gt;=4.12.25 and langsmith&gt;=0.8.18 ([5dd4178](https://github.com/langwatch/langwatch/commit/5dd41782beee86ce4333c255d0914357a4e9716d))
* **security:** bump hono&gt;=4.12.25 and langsmith&gt;=0.8.18 (Dependabot [#1500](https://github.com/langwatch/langwatch/issues/1500), [#1516](https://github.com/langwatch/langwatch/issues/1516)) ([#5211](https://github.com/langwatch/langwatch/issues/5211)) ([5dd4178](https://github.com/langwatch/langwatch/commit/5dd41782beee86ce4333c255d0914357a4e9716d))
* **security:** raise langevals json-repair floor to &gt;=0.60.1 ([a2334ed](https://github.com/langwatch/langwatch/commit/a2334ed903e19bda2aa19b6933ebbc907fcbe3fa))
* **security:** raise langevals json-repair floor to &gt;=0.60.1 (CPU DoS) ([#5778](https://github.com/langwatch/langwatch/issues/5778)) ([a2334ed](https://github.com/langwatch/langwatch/commit/a2334ed903e19bda2aa19b6933ebbc907fcbe3fa))
* **security:** raise langevals pydantic-settings transitive floor ([#5611](https://github.com/langwatch/langwatch/issues/5611)) ([6411587](https://github.com/langwatch/langwatch/commit/64115872d56ea953fdf1a4afd44882509a1759a3))
