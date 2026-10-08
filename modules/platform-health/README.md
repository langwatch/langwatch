# platform-health

Platform health: checks of the services a deployment depends on, all at once or one at a time.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                                                 |
| Subjects       | platform-health                                                                                                                 |
| Halves         | [contract](contract) · [process](process/README.md)                                                                             |
| Api token      | `PlatformHealthApi` = `moduleApi<PlatformHealthApi>()("platform-health")`, `contract/src/platform-health.ts:102` (2 operations) |
| Other token    | `PlatformHealthProbeApi`, `process/src/transport/platform-health-probe.rest.ts:22`                                              |
| Installed by   | api, worker, tasks (process)                                                                                                    |

## What platform-health owns

| Kind            | Name                                                                              | Declared at                                                    |
| --------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Stores required |                                                                                   | `process/src/channels/http/http.platform-health.channels.ts:8` |
| Secrets         | `probeApiKey` (PLATFORM_HEALTH_PROBE_API_KEY), `apiKey` (PLATFORM_HEALTH_API_KEY) | `process/src/app/platform-health.app.ts:63`                    |
| Config          | `publicBaseUrl` (BASE_HOST)                                                       | `contract/src/platform-health.config.ts:4`                     |

Anything else platform-health needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name         | Token           | Module                                |
| ------------ | --------------- | ------------------------------------- |
| `apiKeys`    | `ApiKeyApi`     | [api-key](../api-key/README.md)       |
| `automation` | `AutomationApi` | [automation](../automation/README.md) |
| `langy`      | `LangyApi`      | [langy](../langy/README.md)           |
| `projects`   | `ProjectApi`    | [project](../project/README.md)       |
| `scenarios`  | `ScenarioApi`   | [scenario](../scenario/README.md)     |
| `suites`     | `SuiteApi`      | [suite](../suite/README.md)           |
| `workflow`   | `WorkflowApi`   | [workflow](../workflow/README.md)     |

## Who depends on platform-health

No module names platform-health as a peer.

<!-- readme:generated:end -->
