# Changelog

## [2.3.0](https://github.com/langwatch/langwatch/compare/langevals@v2.2.0...langevals@v2.3.0) (2026-05-03)


### Features

* **nlpgo:** go workflow engine + LLM proxy migration from langwatch_nlp to Go ([#3483](https://github.com/langwatch/langwatch/issues/3483)) ([1d61354](https://github.com/langwatch/langwatch/commit/1d6135424043a5cacf28aaa46b2d5d8dbbb6f1f4))


### Bug Fixes

* **azure:** unblock ragas embedding evaluators on Azure (api_version + extra_headers) ([#3345](https://github.com/langwatch/langwatch/issues/3345)) ([df299c2](https://github.com/langwatch/langwatch/commit/df299c21a2351676ec11fb5ed4f59a107d3f2df8))
* **deps:** upgrade aiohttp, starlette, pillow, lxml ([#3564](https://github.com/langwatch/langwatch/issues/3564)) ([498847e](https://github.com/langwatch/langwatch/commit/498847e43c3088ef68b357c6b04d02d1005a5f9a))
* **deps:** upgrade aiohttp, starlette, pillow, lxml (Python heavy) ([498847e](https://github.com/langwatch/langwatch/commit/498847e43c3088ef68b357c6b04d02d1005a5f9a))
* **deps:** upgrade authlib to 1.6.11 (CVE: JWK Header Injection) ([#3674](https://github.com/langwatch/langwatch/issues/3674)) ([cb8dec4](https://github.com/langwatch/langwatch/commit/cb8dec493b825e465c63671d80b74a5cf008d167))
* **deps:** upgrade authlib to 1.6.11 (Dependabot [#592](https://github.com/langwatch/langwatch/issues/592)) ([cb8dec4](https://github.com/langwatch/langwatch/commit/cb8dec493b825e465c63671d80b74a5cf008d167))
* **deps:** upgrade google-cloud-aiplatform to &gt;= 1.133.0 ([#3706](https://github.com/langwatch/langwatch/issues/3706)) ([123511a](https://github.com/langwatch/langwatch/commit/123511a20f20c5d7a938f8574cb03571aa5f6524))
* **deps:** upgrade nltk, authlib (Dependabot [#612](https://github.com/langwatch/langwatch/issues/612), [#522](https://github.com/langwatch/langwatch/issues/522), [#592](https://github.com/langwatch/langwatch/issues/592), [#593](https://github.com/langwatch/langwatch/issues/593), [#594](https://github.com/langwatch/langwatch/issues/594)) ([#3659](https://github.com/langwatch/langwatch/issues/3659)) ([0576cc0](https://github.com/langwatch/langwatch/commit/0576cc0bafa041bb83dd938e7d5c8f6df6d236ce))
* **deps:** upgrade nltk, authlib to resolve security alerts ([0576cc0](https://github.com/langwatch/langwatch/commit/0576cc0bafa041bb83dd938e7d5c8f6df6d236ce))
* **deps:** upgrade pyasn1, filelock, Pygments, nltk (Python patches) ([#3561](https://github.com/langwatch/langwatch/issues/3561)) ([27152ca](https://github.com/langwatch/langwatch/commit/27152ca723b2e31aa3ac760847b17d8e3dfc3714))
* **deps:** upgrade strawberry-graphql to 0.314.3 (Dependabot [#781](https://github.com/langwatch/langwatch/issues/781), [#782](https://github.com/langwatch/langwatch/issues/782)) ([#3675](https://github.com/langwatch/langwatch/issues/3675)) ([9d993d9](https://github.com/langwatch/langwatch/commit/9d993d9fb8cbc44f163ba956c6c764e6fdd43578))
* **deps:** upgrade tornado, urllib3, cryptography (Dependabot) ([#3657](https://github.com/langwatch/langwatch/issues/3657)) ([f8a2e9a](https://github.com/langwatch/langwatch/commit/f8a2e9a5cf6b836524bc2a170d589e1a01ad3921))
* **deps:** upgrade tornado, urllib3, cryptography to resolve security alerts ([f8a2e9a](https://github.com/langwatch/langwatch/commit/f8a2e9a5cf6b836524bc2a170d589e1a01ad3921))
* **release:** path-routed Release-As shadows for 6 polluted components ([#3627](https://github.com/langwatch/langwatch/issues/3627)) ([b39d59e](https://github.com/langwatch/langwatch/commit/b39d59e87ed6d87224d580271175650c1d4159a7))
* **release:** scope Release-As to langwatch, restore other components ([#3618](https://github.com/langwatch/langwatch/issues/3618)) ([e259e79](https://github.com/langwatch/langwatch/commit/e259e796b50e4d060e5c7f42cad1927f1da8a83d))


### Miscellaneous

* **langevals:** single-footer shadow Release-As 2.3.0 ([76e9ea2](https://github.com/langwatch/langwatch/commit/76e9ea27113465acc41a747164c105713bdfad6b))
* release as 3.2.1 ([ca9d7a9](https://github.com/langwatch/langwatch/commit/ca9d7a9231a7b3d9d8cf9a28a48fa494b1daeb4b))
* release as 3.2.1 (override release-please from 3.3.0) ([#3615](https://github.com/langwatch/langwatch/issues/3615)) ([ca9d7a9](https://github.com/langwatch/langwatch/commit/ca9d7a9231a7b3d9d8cf9a28a48fa494b1daeb4b))
* scope Release-As to langwatch, restore other components ([e259e79](https://github.com/langwatch/langwatch/commit/e259e796b50e4d060e5c7f42cad1927f1da8a83d))


### Code Refactoring

* **ci:** consolidate *-ci.yml and *-ci-unmodified.yml pairs ([#3231](https://github.com/langwatch/langwatch/issues/3231)) ([bcea648](https://github.com/langwatch/langwatch/commit/bcea64835bbb3dd00d7431f278da23d0b47de827))
