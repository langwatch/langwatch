# model-provider

Model providers: the providers configured per project and organisation, which one serves a model, and cost estimates.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                                                  |
| Subjects       | model-provider                                                                                                                   |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser)                                                         |
| Api token      | `ModelProviderApi` = `moduleApi<ModelProviderApi>()("model-provider")`, `contract/src/model-provider.api.ts:357` (50 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                                                                       |

## What model-provider owns

| Kind                           | Name                                                                                                                                                                                                                                                                                                                                                                                                                                           | Declared at                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Postgres, accessed not claimed | `CustomLLMModelCost`, `GatewayChangeEvent`, `ModelDefaultConfig`, `ModelDefaultConfigScope`, `ModelProvider`                                                                                                                                                                                                                                                                                                                                   | `process/src/repositories/prisma/prisma.model-cost.repository.ts:11`  |
| Stores required                | prisma, encryption, redis                                                                                                                                                                                                                                                                                                                                                                                                                      | `process/src/repositories/live/live.model-provider.repositories.ts:9` |
| Secrets                        | ≈ `...ModelProviderModule.platformCredentials`, ≈ `...ModelProviderModule.operationalSecrets`                                                                                                                                                                                                                                                                                                                                                  | `process/src/app/model-provider.app.ts:259`                           |
| Config                         | `blockLocalHttpCalls` (BLOCK_LOCAL_HTTP_CALLS), `allowedProxyHosts` (ALLOWED_PROXY_HOSTS), `defaultModel` (LANGWATCH_DEFAULT_MODEL), `nlpServiceUrl` (LANGWATCH_NLP_SERVICE), `probeBaseUrls.gemini` (GEMINI_BASE_URL), `probeBaseUrls.deepseek` (DEEPSEEK_BASE_URL), `probeBaseUrls.xai` (XAI_BASE_URL), `probeBaseUrls.cerebras` (CEREBRAS_BASE_URL), `probeBaseUrls.groq` (GROQ_BASE_URL), `probeBaseUrls.elevenlabs` (ELEVENLABS_BASE_URL) | `contract/src/model-provider.config.ts:17`                            |

Anything else model-provider needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name            | Token                | Module                                                                  |
| --------------- | -------------------- | ----------------------------------------------------------------------- |
| `dataPrivacy`   | `DataPrivacyApi`     | [data-privacy](../data-privacy/README.md)                               |
| `managed`       | `ManagedProviderApi` | [managed-provider](../../enterprise/modules/managed-provider/README.md) |
| `organizations` | `OrganizationApi`    | [organization](../organization/README.md)                               |
| `permissions`   | `AuthzApi`           | [authz](../authz/README.md)                                             |
| `projects`      | `ProjectApi`         | [project](../project/README.md)                                         |

## Who depends on model-provider

[enterprise-gateway](../../enterprise/modules/enterprise-gateway/README.md), [evaluation](../evaluation/README.md), [evaluator](../evaluator/README.md), [experiment](../experiment/README.md), [gateway](../gateway/README.md), [governance](../../enterprise/modules/governance/README.md), [langy](../langy/README.md), [onboarding](../onboarding/README.md), [ops](../ops/README.md), [prompt](../prompt/README.md), [scenario](../scenario/README.md), [suite](../suite/README.md), [topic](../topic/README.md), [trace](../trace/README.md), [workflow](../workflow/README.md) (as a peer).

<!-- readme:generated:end -->
