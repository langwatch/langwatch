# @langwatch/clickhouse-markers

The tenant markers a ClickHouse statement carries where its tenant predicate went:
`tenantScope(column)` writes `{{tenantScope:<TimeColumn>}}` and `tenantSet()` writes
`{{tenantSet}}`. They are pure string builders with no client, clock or I/O, so a module's
`rules/` may build SQL text with them. `@langwatch/clickhouse-client`'s authorized reader
expands them into the proof's fence (ADR-177 block C) and re-exports all three names.
