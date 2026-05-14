# Stored Objects — Observability Surface

## OTEL Spans

| Span name | Kind | Source | Attributes |
|-----------|------|--------|------------|
| `StoredObjects.extractInlineMediaFromEvent` | INTERNAL | `content-extractor.ts` | `tenant.id`, `stored_objects.purpose`, `stored_objects.owner_kind`, `stored_objects.owner_id`, `stored_objects.refs_extracted` (set on completion) |
| `StoredObjectsService.storeFromBytes` | INTERNAL | `stored-objects.service.ts` | `tenant.id`, `stored_object.purpose`, `stored_object.owner_kind`, `stored_object.media_type`, `stored_object.size_bytes`, `stored_object.id`, `stored_object.sha256`, `stored_object.dedup_hit` |
| `StoredObjectsService.getById` | INTERNAL | `stored-objects.service.ts` | `tenant.id`, `stored_object.id`, `result.found`, `result.storage_missing` |
| `StoredObjectsRepository.insert` | CLIENT | `stored-objects.repository.ts` | `db.system=clickhouse`, `db.operation=INSERT`, `tenant.id`, `stored_object.id`, `stored_object.purpose` |
| `StoredObjectsRepository.findById` | CLIENT | `stored-objects.repository.ts` | `db.system=clickhouse`, `db.operation=SELECT`, `tenant.id`, `stored_object.id`, `result.found` |
| `StoredObjectsRepository.findBySha256` | CLIENT | `stored-objects.repository.ts` | `db.system=clickhouse`, `db.operation=SELECT`, `tenant.id`, `stored_object.sha256`, `result.found` |

The `/api/scenario-events` route is wrapped in a SERVER span via `tracerMiddleware({name: "scenario-events"})`. The span's `tenant.id` is added post-handler by the middleware from `c.var.project.id`.

The `/api/files/:id` route (Phase H) should use `tracerMiddleware({name: "files"})` and set `stored_object.id` on the active span inside the handler.

## Prometheus Metrics

All metrics are registered with prom-client's default `register` and exposed at `/metrics`.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `stored_object_extract_total` | Counter | `purpose` | Every `storeFromBytes` call (hit + miss) |
| `stored_object_dedup_hit_total` | Counter | `purpose` | Calls where content was already stored |
| `stored_object_write_failures_total` | Counter | `purpose` | PUT failures on the storage backend |
| `stored_object_read_failures_total` | Counter | _(none)_ | GET failures on the storage backend |
| `stored_object_size_bytes` | Histogram | `purpose` | Payload size per `storeFromBytes` call |
