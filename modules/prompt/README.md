# prompt

Prompts: versioned prompt configurations, their tags and handles, syncing from the SDK, and the playground that runs them.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                    |
| Subjects       | prompt, prompt-tag, prompt-version                                                                 |
| Halves         | [contract](contract) · [process](process) · [browser](browser) · [client](client)                  |
| Api token      | `PromptApi` = `moduleApi<PromptApi>()("prompt")`, `contract/src/prompt.api.ts:248` (52 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                                         |

## What prompt owns

| Kind                           | Name                                                                                       | Declared at                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Postgres, accessed not claimed | `LlmPromptConfig`, `LlmPromptConfigVersion`, `Project`, `PromptTag`, `PromptTagAssignment` | `process/src/repositories/prisma/prisma.prompt-version.repository.ts:31` |
| Stores required                | prisma, rateLimiter                                                                        | `process/src/repositories/prisma/prisma.prompt.repositories.ts:22`       |

Anything else prompt needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name             | Token              | Module                                        |
| ---------------- | ------------------ | --------------------------------------------- |
| `modelProviders` | `ModelProviderApi` | [model-provider](../model-provider/README.md) |
| `permissions`    | `AuthzApi`         | [authz](../authz/README.md)                   |
| `plans`          | `EntitlementApi`   | [entitlement](../entitlement/README.md)       |
| `projects`       | `ProjectApi`       | [project](../project/README.md)               |
| `workflow`       | `WorkflowApi`      | [workflow](../workflow/README.md)             |

## Who depends on prompt

[audit-log](../audit-log/README.md), [experiment](../experiment/README.md), [langy](../langy/README.md), [onboarding](../onboarding/README.md), [ops](../ops/README.md), [scenario](../scenario/README.md), [suite](../suite/README.md) (as a peer).

<!-- readme:generated:end -->
