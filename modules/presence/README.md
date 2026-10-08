# presence

Presence: who else is looking at this project, where they are, and where their cursor is.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                           |
| Subjects       | presence                                                                                                  |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser)                                  |
| Api token      | `PresenceApi` = `moduleApi<PresenceApi>()("presence")`, `contract/src/presence.api.ts:63` (12 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                                                |

## What presence owns

| Kind            | Name           | Declared at                                                                 |
| --------------- | -------------- | --------------------------------------------------------------------------- |
| Postgres table  | `Project`      | `process/src/repositories/prisma/prisma.presence-settings.repository.ts:10` |
| Postgres table  | `Team`         | `process/src/repositories/prisma/prisma.presence-settings.repository.ts:10` |
| Postgres table  | `Organization` | `process/src/repositories/prisma/prisma.presence-settings.repository.ts:10` |
| Stores required | prisma, redis  | `process/src/repositories/live/live.presence.repositories.ts:11`            |

Anything else presence needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

None: presence declares no peers.

## Who depends on presence

[experiment](../experiment/README.md), [langy](../langy/README.md), [scenario](../scenario/README.md), [trace](../trace/README.md) (as a peer).

<!-- readme:generated:end -->
