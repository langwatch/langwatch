# RFC: Simplify Event Sourcing Pipeline Boilerplate

## Problem

Adding a new command to a pipeline requires touching ~13 files and manually keeping field names in sync across command schemas, event schemas, type guards, command handler classes, constants, store factories, and the pipeline registry.

- Too many files to touch per command
- Easy to drop a field across command/event data (they're near-identical but hand-maintained separately)
- Factory functions like `createMetricRecordStorageMapProjection` are annoying indirection
- Pipeline registry manually resolves ClickHouse-or-Memory repos and wires through factory chains

## Proposed changes

### 1. `defineCommand()` — Zod-schema-first command definition

Event data schema is the source of truth. Command schema derived via `withCommandEnvelope()`. `stripEnvelope()` replaces hand-written `mapToEventData`.

```typescript
export const StartSuiteRunCommand = defineCommand({
  commandType: "lw.suite_run.start",
  eventType: "lw.suite_run.started",
  eventVersion: "2026-03-01",
  aggregateType: "suite_run",
  schema: suiteRunStartedEventDataSchema,
  aggregateId: (d) => d.batchRunId,
  idempotencyKey: (d) => `${d.tenantId}:${d.batchRunId}:${d.idempotencyKey}`,
});
```

Eliminates: separate command Zod schemas, type guards, base command handlers, individual command class files.

### 2. `AbstractMapProjection` — mirrors fold projection pattern

Same Zod-schema-first approach as `AbstractFoldProjection`, with auto-injected `CreatedAt`.

```typescript
class LogRecordStorageMapProjection
  extends AbstractMapProjection<NormalizedLogRecord, typeof logEvents>
  implements MapEventHandlers<typeof logEvents, NormalizedLogRecord>
{
  mapObsTraceLogRecordReceived(event: LogRecordReceivedEvent): NormalizedLogRecord {
    return { ... };
  }
}
```

### 3. Complex commands — plain classes, no factories

Convert `create*CommandClass` factories to regular classes with constructor DI. Extend `.withCommand()` to accept pre-constructed instances.

Remove prisma from command handlers — services only.

### 4. `RepositoryFoldStore` — generic adapter

Replaces identical per-pipeline `createXxxStateFoldStore()` factories.

### 5. Push repo resolution to composition root

Move ClickHouse-or-Memory repo construction from `PipelineRegistry` to `presets.ts`.

## Design decisions

- **Trace-processing excluded from `defineCommand()`** — routing fields diverge, `recordSpan` mutates data
- **`experimentRunStateFoldStore` kept** — has custom `parseExperimentRunKey` logic
- **`EvaluationRunStore` kept** — has custom `storeBatch`

See full plan: `.claude/plans/adaptive-toasting-hartmanis.md` (local only)
