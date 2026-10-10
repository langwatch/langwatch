# saas

LangWatch Cloud's own surface. Every operation refuses on any other deployment.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                         |
| -------------- | --------------------------------------------------------------------------------------- |
| Classification | enterprise (`modules/catalogue.json`)                                                   |
| Subjects       | saas                                                                                    |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser)                |
| Api token      | `SaasApi` = `moduleApi<SaasApi>()("saas")`, `contract/src/saas.api.ts:46` (1 operation) |
| Installed by   | api, worker, tasks (process); ui (browser)                                              |

## What saas owns

| Kind            | Name                                                                                                                                                              | Declared at                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Stores required | rateLimiter                                                                                                                                                       | `process/src/repositories/live/live.saas.repositories.ts:9` |
| Config          | `isSaas` (IS_SAAS), `latestRelease` (LANGWATCH_LATEST_RELEASE), `latestReleaseCommit` (LANGWATCH_LATEST_RELEASE_COMMIT), `releaseFloor` (LANGWATCH_RELEASE_FLOOR) | `contract/src/saas.config.ts:18`                            |

Anything else saas needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name        | Token          | Module                              |
| ----------- | -------------- | ----------------------------------- |
| `licensing` | `LicensingApi` | [licensing](../licensing/README.md) |

## Who depends on saas

No module names saas as a peer.

<!-- readme:generated:end -->
