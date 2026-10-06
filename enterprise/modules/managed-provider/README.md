# managed-provider

Enterprise managed model providers: the policy for providers a deployment configures centrally, resolving which projects they serve, and AWS role chaining for them.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Classification | enterprise (`modules/catalogue.json`)                                                                                                  |
| Subjects       | managed-model-provider, managed-provider                                                                                               |
| Halves         | [contract](contract) · [process](process) · [browser](browser)                                                                         |
| Api token      | `ManagedProviderApi` = `moduleApi<ManagedProviderApi>()("managed-provider")`, `contract/src/managed-provider.api.ts:40` (2 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                                                                             |

## What managed-provider owns

| Kind    | Name                    | Declared at                                  |
| ------- | ----------------------- | -------------------------------------------- |
| Secrets | MANAGED_BEDROCK_CONFIGS | `process/src/app/managed-provider.app.ts:23` |

Anything else managed-provider needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

None: managed-provider declares no peers.

## Who depends on managed-provider

[model-provider](../../../modules/model-provider/README.md) (as a peer).

<!-- readme:generated:end -->
