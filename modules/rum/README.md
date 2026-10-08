# rum

The platform's own browser telemetry, proxied to its collector (ADR-058).

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                     |
| -------------- | ----------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                     |
| Subjects       | rum                                                                                 |
| Halves         | [contract](contract) · [process](process/README.md)                                 |
| Api token      | `RumApi` = `moduleApi<RumApi>()("rum")`, `contract/src/rum.api.ts:27` (1 operation) |
| Installed by   | api, worker, tasks (process)                                                        |

## What rum owns

| Kind            | Name                                                                                                                                                       | Declared at                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Stores required |                                                                                                                                                            | `process/src/channels/http/http.rum.channels.ts:17`          |
| Stores required | redis                                                                                                                                                      | `process/src/repositories/redis/redis.rum.repositories.ts:7` |
| Secrets         | RUM_COLLECTOR_HEADERS                                                                                                                                      | `process/src/app/rum.app.ts:29`                              |
| Config          | `enabled` (RUM_ENABLED), `sampleRatio` (RUM_SAMPLE_RATIO), `collectorEndpoint` (RUM_COLLECTOR_ENDPOINT), `telemetryEndpoint` (OTEL_EXPORTER_OTLP_ENDPOINT) | `contract/src/rum.config.ts:14`                              |

Anything else rum needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

None: rum declares no peers.

## Who depends on rum

No module names rum as a peer.

<!-- readme:generated:end -->
